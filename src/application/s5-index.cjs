'use strict';

const { createHash } = require('node:crypto');
const { S4ApplicationService } = require('./s4-index.cjs');
const { ProjectionRepository } = require('./projection-repository.cjs');
const { createProviderContractSnapshot } = require('../domain/provider-contract-snapshot.cjs');
const {
  assertProviderObservationAllowed,
  createProviderAdapterDefinition,
  createProviderObservation,
  createProviderTargetBinding,
  sameBindingIntent,
} = require('../provider-adapters/domain/index.cjs');
const { BoundedReadOnlyHttpTransport, ProviderTransportError } = require('../provider-adapters/transport/read-only-http-transport.cjs');
const {
  NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER,
  PROVIDER_ADAPTERS,
  VERCEL_PUBLIC_DEPLOYMENT_ADAPTER,
  assertNetlifyPublicTarget,
  assertVercelPublicTarget,
  normalizeProviderObservation,
} = require('../provider-adapters/providers/index.cjs');

const S5_ACTION = 'observe_public_deployment';
const S5_CONTRACTS = Object.freeze({
  vercel: Object.freeze({
    id: 'provider-vercel-public',
    providerId: 'vercel',
    surfaceId: 'public-deployment',
    governingTermsDigest: `sha256:${createHash('sha256').update('s5:vercel:public-deployment:read-only:v1').digest('hex')}`,
  }),
  netlify: Object.freeze({
    id: 'provider-netlify-public',
    providerId: 'netlify',
    surfaceId: 'public-deployment',
    governingTermsDigest: `sha256:${createHash('sha256').update('s5:netlify:public-deployment:read-only:v1').digest('hex')}`,
  }),
});

function boundedId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20)}`;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function sameObservationIntent(existing, { workspaceId, bindingId, method }) {
  return existing.workspaceId === workspaceId
    && existing.bindingId === bindingId
    && existing.method === method;
}

function adapterDomainDefinition(definition) {
  return createProviderAdapterDefinition({
    id: definition.id,
    provider: definition.provider,
    version: definition.version,
    status: 'available',
    actions: [{
      id: definition.action,
      methods: [...definition.methods],
      responseBodyPolicy: definition.responseBodyPolicy,
      actionClass: definition.actionClass,
    }],
  });
}

class S5ApplicationService extends S4ApplicationService {
  constructor(options = {}) {
    super(options);
    this.providerTransport = options.providerTransport || new BoundedReadOnlyHttpTransport({ clock: this.clock });
    this.providerTargetBinding = new ProjectionRepository({ store: this.store, projectionType: 'providerTargetBinding' });
    this.providerObservation = new ProjectionRepository({ store: this.store, projectionType: 'providerObservation' });
    this.s5AdapterDefinitions = Object.freeze(Object.fromEntries(PROVIDER_ADAPTERS.map((definition) => [definition.id, adapterDomainDefinition(definition)])));
    this.seedS5ProviderContracts();
  }

  seedS5ProviderContracts() {
    for (const contract of Object.values(S5_CONTRACTS)) {
      if (this.providerSnapshot.get(contract.id)) continue;
      this.providerSnapshot.save({
        id: contract.id,
        ...createProviderContractSnapshot({
          contractId: contract.id,
          providerId: contract.providerId,
          surfaceId: contract.surfaceId,
          status: 'accepted',
          reviewedAt: '2026-08-07T00:00:00.000Z',
          expiresAt: '2027-08-07T00:00:00.000Z',
          governingTermsDigest: contract.governingTermsDigest,
          permittedActions: [S5_ACTION],
          prohibitedActions: ['deploy', 'promote', 'rollback', 'mutate_environment', 'mutate_secret'],
        }),
      }, 'provider_contract.accepted');
    }
  }

  appendS5Event({ type, workspaceId, aggregateType, aggregateId, idempotencyKey, payload = {} }) {
    return this.store.appendEvent({
      workspaceId,
      aggregateType,
      aggregateId,
      eventType: type,
      eventVersion: 1,
      idempotencyKey,
      occurredAt: this.clock(),
      payload,
      metadata: { source: 's5-application', providerMode: 'read_only', responseBodyPolicy: 'none' },
    }).event;
  }

  requireS5Workspace(id) {
    const workspace = this.workspace.get(id);
    if (!workspace || workspace.status !== 'active') throw new Error(`Workspace not found or inactive: ${id}`);
    return workspace;
  }

  requireS5Binding(workspaceId, bindingId) {
    const binding = this.providerTargetBinding.get(bindingId);
    if (!binding) throw new Error(`ProviderTargetBinding not found: ${bindingId}`);
    if (binding.workspaceId !== workspaceId) throw new Error('Cross-Workspace ProviderTargetBinding access denied');
    return binding;
  }

  providerDefinition(provider, adapterId) {
    const definition = this.s5AdapterDefinitions[adapterId];
    if (!definition || definition.provider !== provider) throw new Error('Unknown or mismatched S5 provider adapter');
    return definition;
  }

  assertProviderClassification(provider, target) {
    if (provider === 'vercel') return assertVercelPublicTarget(target);
    if (provider === 'netlify') return assertNetlifyPublicTarget(target);
    throw new Error('Unsupported S5 provider');
  }

  bindProviderTarget(input) {
    plainObject(input, 'Provider target binding input');
    this.requireS5Workspace(input.workspaceId);
    const definition = this.providerDefinition(input.provider, input.adapterId);
    this.assertProviderClassification(input.provider, input.exactTarget);
    const candidate = createProviderTargetBinding({
      id: input.id || boundedId('providerbinding', input.workspaceId, input.provider, input.adapterId, input.exactTarget),
      workspaceId: input.workspaceId,
      provider: input.provider,
      adapterId: input.adapterId,
      providerContractId: input.providerContractId,
      action: input.action || S5_ACTION,
      exactTarget: input.exactTarget,
      status: input.status || 'active',
    });
    const snapshot = this.providerSnapshot.get(candidate.providerContractId);
    assertProviderObservationAllowed({
      binding: candidate,
      adapter: definition,
      snapshot,
      method: 'GET',
      now: new Date(this.clock()),
    });
    const existing = this.providerTargetBinding.get(candidate.id);
    if (existing) {
      if (!sameBindingIntent(existing, candidate)) throw new Error(`ProviderTargetBinding idempotency collision: ${candidate.id}`);
      return existing;
    }
    const stored = this.providerTargetBinding.save(candidate, 'provider.target_bound');
    this.appendS5Event({
      type: 'provider.target_bound',
      workspaceId: stored.workspaceId,
      aggregateType: 'providerTargetBinding',
      aggregateId: stored.id,
      idempotencyKey: `provider.target_bound:${stored.id}`,
      payload: {
        bindingId: stored.id,
        provider: stored.provider,
        adapterId: stored.adapterId,
        providerContractId: stored.providerContractId,
        action: stored.action,
        exactTarget: stored.exactTarget,
      },
    });
    return stored;
  }

  async observeProvider(input) {
    plainObject(input, 'Provider observation input');
    this.requireS5Workspace(input.workspaceId);
    const binding = this.requireS5Binding(input.workspaceId, input.bindingId);
    const definition = this.providerDefinition(binding.provider, binding.adapterId);
    const method = String(input.method || 'GET').toUpperCase();
    const snapshot = this.providerSnapshot.get(binding.providerContractId);
    assertProviderObservationAllowed({ binding, adapter: definition, snapshot, method, now: new Date(this.clock()) });
    this.assertProviderClassification(binding.provider, binding.exactTarget);

    const observationId = input.id || boundedId('providerobs', input.workspaceId, binding.id, method, this.clock(), this.providerObservation.list().length);
    const existing = this.providerObservation.get(observationId);
    if (existing) {
      if (!sameObservationIntent(existing, { workspaceId: input.workspaceId, bindingId: binding.id, method })) {
        throw new Error(`ProviderObservation idempotency collision: ${observationId}`);
      }
      return Object.freeze({ replayed: true, networkRequested: false, observation: existing });
    }

    this.appendS5Event({
      type: 'provider.observation_requested',
      workspaceId: input.workspaceId,
      aggregateType: 'providerObservation',
      aggregateId: observationId,
      idempotencyKey: `provider.observation_requested:${observationId}`,
      payload: { observationId, bindingId: binding.id, provider: binding.provider, adapterId: binding.adapterId, action: binding.action, method },
    });

    const auditBefore = typeof this.providerTransport.methodAudit === 'function' ? this.providerTransport.methodAudit().length : 0;
    let bounded;
    try {
      bounded = await this.providerTransport.observe({ approvedTarget: binding.exactTarget, method });
    } catch (error) {
      if (!(error instanceof ProviderTransportError)) throw error;
      bounded = Object.freeze({
        state: 'blocked',
        method,
        target: binding.exactTarget,
        finalTarget: binding.exactTarget,
        statusCode: null,
        headers: Object.freeze({}),
        redirects: Object.freeze([]),
        observedAt: this.clock(),
        failureCode: error.code || 'transport_blocked',
      });
    }
    const auditAfter = typeof this.providerTransport.methodAudit === 'function' ? this.providerTransport.methodAudit().length : auditBefore;
    const normalized = normalizeProviderObservation({ provider: binding.provider, boundedObservation: bounded });
    const domainObservation = createProviderObservation({
      id: observationId,
      workspaceId: input.workspaceId,
      bindingId: binding.id,
      adapterId: binding.adapterId,
      provider: binding.provider,
      action: binding.action,
      method: normalized.method,
      exactTarget: binding.exactTarget,
      state: normalized.state,
      observedAt: normalized.observedAt,
      statusCode: normalized.statusCode,
      normalizedHeaders: normalized.headers,
      failureCode: normalized.failureCode,
    });
    const stored = this.providerObservation.save({
      ...domainObservation,
      adapterVersion: normalized.adapterVersion,
      finalTarget: normalized.finalTarget,
      redirects: normalized.redirects,
      providerNormalizerDigest: normalized.normalizerDigest,
    }, 'provider.observation_recorded');
    this.appendS5Event({
      type: 'provider.observation_recorded',
      workspaceId: stored.workspaceId,
      aggregateType: 'providerObservation',
      aggregateId: stored.id,
      idempotencyKey: `provider.observation_recorded:${stored.id}:${stored.evidenceDigest}`,
      payload: {
        observationId: stored.id,
        bindingId: stored.bindingId,
        provider: stored.provider,
        adapterId: stored.adapterId,
        adapterVersion: stored.adapterVersion,
        action: stored.action,
        method: stored.method,
        exactTarget: stored.exactTarget,
        finalTarget: stored.finalTarget,
        state: stored.state,
        statusCode: stored.statusCode,
        failureCode: stored.failureCode,
        evidenceDigest: stored.evidenceDigest,
        providerNormalizerDigest: stored.providerNormalizerDigest,
        redirectCount: stored.redirects.length,
      },
    });
    return Object.freeze({ replayed: false, networkRequested: auditAfter > auditBefore, observation: stored });
  }

  queryProviderState(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('workspaceId is required');
    const workspace = this.workspace.get(workspaceId);
    if (!workspace) return Object.freeze({ workspaceId, found: false, adapters: Object.freeze([]), contracts: Object.freeze([]), bindings: Object.freeze([]), observations: Object.freeze([]), methodAudit: Object.freeze([]) });
    const bindings = this.providerTargetBinding.list().filter((item) => item.workspaceId === workspaceId);
    const observations = this.providerObservation.list().filter((item) => item.workspaceId === workspaceId);
    const targets = new Set(bindings.map((item) => item.exactTarget));
    const audit = typeof this.providerTransport.methodAudit === 'function'
      ? this.providerTransport.methodAudit().filter((item) => targets.has(item.target))
      : [];
    return Object.freeze({
      workspaceId,
      found: true,
      adapters: Object.freeze(Object.values(this.s5AdapterDefinitions)),
      contracts: Object.freeze(this.providerSnapshot.list().filter((item) => item.providerId === 'vercel' || item.providerId === 'netlify')),
      bindings: Object.freeze(bindings),
      observations: Object.freeze(observations),
      methodAudit: Object.freeze(audit),
    });
  }

  queryOperatorCockpit(workspaceId) {
    const cockpit = super.queryOperatorCockpit(workspaceId);
    return Object.freeze({ ...cockpit, providerAdapters: this.queryProviderState(workspaceId) });
  }
}

module.exports = {
  S5_ACTION,
  S5_CONTRACTS,
  S5ApplicationService,
};
