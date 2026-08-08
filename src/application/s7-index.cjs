'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { ProjectionRepository } = require('./projection-repository.cjs');
const { S6SchedulingApplicationService } = require('./s6-scheduler-service.cjs');
const {
  acknowledgeCursor,
  assertCollaborationPayload,
  createSyncAck,
  createSyncCursor,
  createSyncDivergence,
  createSyncEnvelope,
  createSyncSourceInstance,
  digest,
} = require('../sync/envelope/index.cjs');
const {
  createSharedWorkspaceSnapshot,
  createWorkspaceMembership,
} = require('../sync/collaboration/index.cjs');

const LOCAL_OPERATOR_SUBJECT = 'local-operator';
const SYNC_SCHEMA_VERSION = '1';
const CONFIG_STATUSES = new Set(['disabled', 'enabled', 'paused']);

function boundedId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20)}`;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  return input;
}

function publicRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const { _revision, ...rest } = record;
  return rest;
}

function publicEnvelope(record) {
  const value = publicRecord(record);
  return Object.freeze({
    id: value.id,
    workspaceId: value.workspaceId,
    sourceInstanceId: value.sourceInstanceId,
    cursor: value.cursor,
    schemaVersion: value.schemaVersion,
    recordClass: value.recordClass,
    recordId: value.recordId,
    recordRevision: value.recordRevision,
    payload: value.payload,
    payloadDigest: value.payloadDigest,
    previousEnvelopeDigest: value.previousEnvelopeDigest,
    envelopeDigest: value.envelopeDigest,
    createdAt: value.createdAt,
  });
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, compact(nested)]));
  }
  return value;
}

function latestByTime(records, timeKey = 'updatedAt') {
  return [...records].sort((left, right) => String(right?.[timeKey] || '').localeCompare(String(left?.[timeKey] || '')))[0] || null;
}

class S7ApplicationService extends S6SchedulingApplicationService {
  constructor(options = {}) {
    super(options);
    this.syncEndpoint = options.syncEndpoint || null;
    this.syncTransport = options.syncTransport || null;
    this.syncConfiguration = new ProjectionRepository({ store: this.store, projectionType: 'syncConfiguration' });
    this.syncSourceInstance = new ProjectionRepository({ store: this.store, projectionType: 'syncSourceInstance' });
    this.syncEnvelope = new ProjectionRepository({ store: this.store, projectionType: 'syncEnvelope' });
    this.syncCursor = new ProjectionRepository({ store: this.store, projectionType: 'syncCursor' });
    this.syncAck = new ProjectionRepository({ store: this.store, projectionType: 'syncAck' });
    this.syncDivergence = new ProjectionRepository({ store: this.store, projectionType: 'syncDivergence' });
    this.workspaceMembership = new ProjectionRepository({ store: this.store, projectionType: 'workspaceMembership' });
    this.syncRemoteMirror = new ProjectionRepository({ store: this.store, projectionType: 'syncRemoteMirror' });
    this.ensureSyncSourceInstance();
  }

  appendS7Event({ type, workspaceId, aggregateType, aggregateId, idempotencyKey, payload = {} }) {
    return this.store.appendEvent({
      workspaceId,
      aggregateType,
      aggregateId,
      eventType: type,
      eventVersion: 1,
      idempotencyKey,
      occurredAt: this.clock(),
      payload,
      metadata: { source: 's7-application', remoteExecutionAuthority: 'none', collaborationMirrorOnly: true },
    }).event;
  }

  requireS7Workspace(workspaceId) {
    const workspace = this.workspace.get(workspaceId);
    if (!workspace || workspace.status !== 'active') throw new Error(`Workspace not found or inactive: ${workspaceId}`);
    return workspace;
  }

  ensureSyncSourceInstance() {
    const current = this.syncSourceInstance.list().find((item) => item.status === 'active');
    if (current) return current;
    const opaque = `sync-source-${randomUUID()}`;
    const candidate = createSyncSourceInstance({
      id: opaque,
      instancePublicId: opaque,
      status: 'active',
      createdAt: this.clock(),
    });
    return this.syncSourceInstance.save(candidate, 'sync.source_instance_created');
  }

  activeSourceInstance() {
    return this.syncSourceInstance.list().find((item) => item.status === 'active') || this.ensureSyncSourceInstance();
  }

  configurationFor(workspaceId) {
    return this.syncConfiguration.get(boundedId('syncconfig', workspaceId)) || null;
  }

  cursorFor(workspaceId) {
    const source = this.activeSourceInstance();
    const id = boundedId('synccursor', workspaceId, source.id);
    return this.syncCursor.get(id) || Object.freeze({
      id,
      ...createSyncCursor({
        workspaceId,
        sourceInstanceId: source.id,
        lastProducedCursor: 0,
        lastAcknowledgedCursor: 0,
        lastEnvelopeDigest: null,
        status: this.configurationFor(workspaceId)?.status === 'enabled' ? 'current' : 'unavailable',
        updatedAt: this.clock(),
      }),
    });
  }

  saveCursor(cursor, reason) {
    const id = cursor.id || boundedId('synccursor', cursor.workspaceId, cursor.sourceInstanceId);
    return this.syncCursor.save({ id, ...publicRecord(cursor) }, reason);
  }

  configureSync(input) {
    plainObject(input, 'S7 sync configuration input');
    assertAllowedKeys(input, new Set(['workspaceId', 'status']), 'S7 sync configuration input');
    const workspaceId = String(input.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const status = String(input.status || '');
    if (!CONFIG_STATUSES.has(status)) throw new Error(`Invalid S7 sync status: ${status}`);
    if (status === 'enabled' && (!this.syncEndpoint || !this.syncTransport)) throw new Error('sync_endpoint_unavailable');
    const id = boundedId('syncconfig', workspaceId);
    const existing = this.syncConfiguration.get(id);
    const record = Object.freeze({
      id,
      workspaceId,
      status,
      endpointId: this.syncEndpoint?.id || null,
      schemaVersion: SYNC_SCHEMA_VERSION,
      createdAt: existing?.createdAt || this.clock(),
      updatedAt: this.clock(),
    });
    if (existing && existing.status === record.status && existing.endpointId === record.endpointId && existing.schemaVersion === record.schemaVersion) return existing;
    const stored = this.syncConfiguration.save(record, 'sync.configuration_recorded');
    this.appendS7Event({
      type: 'sync.configuration_recorded',
      workspaceId,
      aggregateType: 'syncConfiguration',
      aggregateId: stored.id,
      idempotencyKey: `sync.configuration_recorded:${stored.id}:${stored._revision}`,
      payload: { configurationId: stored.id, status: stored.status, endpointId: stored.endpointId, schemaVersion: stored.schemaVersion },
    });
    const cursor = this.cursorFor(workspaceId);
    this.saveCursor(createSyncCursor({
      ...publicRecord(cursor),
      status: status === 'enabled' ? 'current' : 'unavailable',
      updatedAt: this.clock(),
    }), 'sync.cursor_configuration_state');
    return stored;
  }

  recordMembership(input) {
    plainObject(input, 'S7 membership input');
    assertAllowedKeys(input, new Set(['id', 'workspaceId', 'subjectId', 'teamRoleId', 'status', 'createdAt']), 'S7 membership input');
    this.requireS7Workspace(input.workspaceId);
    const candidate = createWorkspaceMembership({ ...input, createdAt: input.createdAt || this.clock() });
    const existing = this.workspaceMembership.get(candidate.id);
    if (existing
      && existing.workspaceId === candidate.workspaceId
      && existing.subjectId === candidate.subjectId
      && existing.teamRoleId === candidate.teamRoleId
      && existing.status === candidate.status) return existing;
    if (existing && (existing.workspaceId !== candidate.workspaceId || existing.subjectId !== candidate.subjectId)) {
      throw new Error(`WorkspaceMembership idempotency collision: ${candidate.id}`);
    }
    const stored = this.workspaceMembership.save(candidate, 'sync.membership_recorded');
    this.appendS7Event({
      type: 'sync.membership_recorded',
      workspaceId: stored.workspaceId,
      aggregateType: 'workspaceMembership',
      aggregateId: stored.id,
      idempotencyKey: `sync.membership_recorded:${stored.id}:${stored._revision}`,
      payload: { membershipId: stored.id, subjectId: stored.subjectId, teamRoleId: stored.teamRoleId, status: stored.status },
    });
    return stored;
  }

  localOperatorMembership(workspaceId) {
    return this.workspaceMembership.list().find((item) => item.workspaceId === workspaceId && item.subjectId === LOCAL_OPERATOR_SUBJECT && item.status === 'active') || null;
  }

  collaborationRecords(workspaceId) {
    const workspace = this.requireS7Workspace(workspaceId);
    const missionState = this.queryMissionState(workspaceId);
    const scheduling = this.querySchedulingState(workspaceId);
    const github = this.queryGitHubDeliveryState(workspaceId);
    const providers = this.queryProviderState(workspaceId);
    const records = [];
    const add = (recordClass, recordId, payload) => {
      if (!recordId) return;
      records.push(Object.freeze({ recordClass, recordId, payload: assertCollaborationPayload(recordClass, compact(payload)) }));
    };

    add('workspace.summary', workspace.id, {
      id: workspace.id,
      name: workspace.name || workspace.title || workspace.id,
      status: workspace.status,
      projectId: workspace.projectId || null,
      updatedAt: workspace.updatedAt || workspace.createdAt || this.clock(),
    });

    for (const mission of missionState.missions || []) {
      const runs = (missionState.missionRuns || []).filter((item) => item.missionId === mission.id);
      const run = latestByTime(runs, 'startedAt') || runs[runs.length - 1] || null;
      add('mission.summary', mission.id, {
        id: mission.id,
        title: mission.title || mission.objective || mission.id,
        status: run?.state || mission.status || 'defined',
        revision: mission.currentRevision || mission.revision || null,
        runId: run?.id || null,
        updatedAt: run?.updatedAt || run?.completedAt || run?.startedAt || mission.updatedAt || mission.createdAt || this.clock(),
      });
    }

    for (const plan of missionState.plans || []) {
      for (const step of plan.steps || []) {
        add('plan-step.summary', step.id, {
          id: step.id,
          missionId: plan.missionId || null,
          name: step.name || step.id,
          state: step.state,
          priority: step.priority || 'normal',
          updatedAt: step.updatedAt || plan.updatedAt || plan.createdAt || this.clock(),
        });
      }
    }

    for (const gate of missionState.humanGates || []) {
      add('human-gate.summary', gate.id, {
        id: gate.id,
        missionId: gate.missionId || gate.missionRunId || null,
        stepId: gate.stepId || gate.stepAttemptId || null,
        state: gate.state,
        reasonCode: gate.reasonCode || gate.reason || null,
        requestedAt: gate.requestedAt || gate.createdAt || null,
        updatedAt: gate.updatedAt || gate.decidedAt || gate.createdAt || this.clock(),
      });
    }

    for (const decision of scheduling.decisions || []) {
      add('scheduling.summary', decision.id, {
        id: decision.id,
        policyId: decision.policySnapshotId || scheduling.policy?.id || null,
        selectedCandidateId: decision.selectedCandidateId || null,
        selectedWorkerPublicId: decision.selectedWorkerId || null,
        reasonCodes: decision.reasonCodes || [],
        inputDigest: decision.inputDigest || null,
        decisionDigest: decision.decisionDigest || null,
        evaluatedAt: decision.evaluatedAt || this.clock(),
      });
    }

    for (const gate of github.deliveryGates || []) {
      const binding = (github.pullRequestBindings || []).find((item) => item.id === gate.pullRequestBindingId) || null;
      add('github-delivery.summary', gate.id, {
        id: gate.id,
        repository: binding?.repository || binding?.repositoryFullName || null,
        pullRequestNumber: binding?.number || null,
        headSha: gate.evaluatedHeadSha || binding?.expectedHeadSha || null,
        state: gate.state,
        gateState: gate.state,
        observedAt: gate.evaluatedAt || gate.updatedAt || this.clock(),
      });
    }

    for (const observation of providers.observations || []) {
      add('provider-observation.summary', observation.id, {
        id: observation.id,
        provider: observation.provider,
        action: observation.action,
        state: observation.state,
        statusCode: observation.statusCode,
        targetClass: 'approved_public_deployment',
        observedAt: observation.observedAt,
        evidenceDigest: observation.evidenceDigest,
      });
    }

    const liveById = new Map(this.workerManager.list().map((item) => [item.id, item]));
    for (const binding of this.workerBinding.list().filter((item) => item.workspaceId === workspaceId)) {
      const workerId = binding.id || binding.workerId;
      const live = liveById.get(workerId) || null;
      const statusClass = live?.status === 'idle' ? 'available'
        : live?.status === 'active' || live?.status === 'waiting_human' ? 'busy'
          : live?.status === 'paused' ? 'paused'
            : live ? 'unknown' : 'offline';
      add('worker-presence.summary', workerId, {
        workerPublicId: workerId,
        workspaceId,
        statusClass,
        browserChannelClass: ['chrome', 'chromium'].includes(live?.browserChannel || binding.browserChannel) ? (live?.browserChannel || binding.browserChannel) : 'unknown',
        role: binding.role || live?.role || 'unknown',
        observedAt: this.clock(),
      });
    }

    return Object.freeze(records);
  }

  compilePendingSyncEnvelopes(workspaceId) {
    this.requireS7Workspace(workspaceId);
    const source = this.activeSourceInstance();
    let cursor = this.cursorFor(workspaceId);
    const all = this.syncEnvelope.list()
      .filter((item) => item.workspaceId === workspaceId && item.sourceInstanceId === source.id)
      .sort((left, right) => left.cursor - right.cursor);
    const latestByRecord = new Map();
    for (const item of all) latestByRecord.set(`${item.recordClass}:${item.recordId}`, item);

    for (const record of this.collaborationRecords(workspaceId)) {
      const key = `${record.recordClass}:${record.recordId}`;
      const previous = latestByRecord.get(key) || null;
      const payloadDigest = digest(record.payload);
      if (previous?.payloadDigest === payloadDigest) continue;
      const nextCursor = cursor.lastProducedCursor + 1;
      const envelope = createSyncEnvelope({
        id: boundedId('syncenv', workspaceId, source.id, nextCursor, record.recordClass, record.recordId),
        workspaceId,
        sourceInstanceId: source.id,
        cursor: nextCursor,
        schemaVersion: SYNC_SCHEMA_VERSION,
        recordClass: record.recordClass,
        recordId: record.recordId,
        recordRevision: previous ? Number(previous.recordRevision || 0) + 1 : 1,
        payload: record.payload,
        previousEnvelopeDigest: cursor.lastEnvelopeDigest,
        createdAt: this.clock(),
      });
      const stored = this.syncEnvelope.save(envelope, 'sync.envelope_produced');
      this.appendS7Event({
        type: 'sync.envelope_produced',
        workspaceId,
        aggregateType: 'syncEnvelope',
        aggregateId: stored.id,
        idempotencyKey: `sync.envelope_produced:${stored.id}:${stored.envelopeDigest}`,
        payload: {
          envelopeId: stored.id,
          sourceInstanceId: stored.sourceInstanceId,
          cursor: stored.cursor,
          recordClass: stored.recordClass,
          recordId: stored.recordId,
          payloadDigest: stored.payloadDigest,
          envelopeDigest: stored.envelopeDigest,
          previousEnvelopeDigest: stored.previousEnvelopeDigest,
        },
      });
      cursor = this.saveCursor(createSyncCursor({
        ...publicRecord(cursor),
        lastProducedCursor: stored.cursor,
        lastEnvelopeDigest: stored.envelopeDigest,
        status: 'current',
        updatedAt: this.clock(),
      }), 'sync.cursor_produced');
      latestByRecord.set(key, stored);
    }

    const finalCursor = this.cursorFor(workspaceId);
    return Object.freeze(this.syncEnvelope.list()
      .filter((item) => item.workspaceId === workspaceId
        && item.sourceInstanceId === source.id
        && item.cursor > finalCursor.lastAcknowledgedCursor)
      .sort((left, right) => left.cursor - right.cursor)
      .map(publicEnvelope));
  }

  async pushPendingSync(input) {
    plainObject(input, 'S7 push input');
    assertAllowedKeys(input, new Set(['workspaceId']), 'S7 push input');
    const workspaceId = String(input.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const configuration = this.configurationFor(workspaceId);
    if (!configuration || configuration.status !== 'enabled') throw new Error('sync_not_enabled');
    if (!this.syncEndpoint || !this.syncTransport) throw new Error('sync_endpoint_unavailable');
    const source = this.activeSourceInstance();
    const pending = this.compilePendingSyncEnvelopes(workspaceId);
    if (!pending.length) return Object.freeze({ networkRequested: false, accepted: 0, duplicate: 0, cursor: publicRecord(this.cursorFor(workspaceId)) });

    let response;
    try {
      response = await this.syncTransport.appendEnvelopes({ workspaceId, sourceInstanceId: source.id, envelopes: pending });
    } catch (error) {
      const current = this.cursorFor(workspaceId);
      this.saveCursor(createSyncCursor({ ...publicRecord(current), status: 'unavailable', updatedAt: this.clock() }), 'sync.transport_unavailable');
      this.appendS7Event({
        type: 'sync.transport_unavailable',
        workspaceId,
        aggregateType: 'syncConfiguration',
        aggregateId: configuration.id,
        idempotencyKey: `sync.transport_unavailable:${configuration.id}:${this.clock()}`,
        payload: { endpointId: configuration.endpointId, reasonCode: 'transport_unavailable' },
      });
      throw error;
    }

    let cursor = this.cursorFor(workspaceId);
    let accepted = 0;
    let duplicate = 0;
    for (const rawAck of response?.acks || []) {
      const envelope = pending.find((item) => item.cursor === rawAck.cursor && item.envelopeDigest === rawAck.envelopeDigest);
      if (!envelope) throw new Error('sync_ack_scope_mismatch');
      if (rawAck.state === 'accepted' || rawAck.state === 'duplicate') {
        const ack = createSyncAck({
          workspaceId,
          sourceInstanceId: source.id,
          cursor: envelope.cursor,
          envelopeDigest: envelope.envelopeDigest,
          state: rawAck.state,
          reasonCode: rawAck.reasonCode || (rawAck.state === 'duplicate' ? 'exact_duplicate' : 'append_current'),
          observedAt: this.clock(),
        });
        this.syncAck.save({ id: boundedId('syncack', workspaceId, source.id, ack.cursor, ack.envelopeDigest), ...ack }, 'sync.ack_recorded');
        cursor = this.saveCursor(acknowledgeCursor({ cursor: publicRecord(cursor), envelope, state: rawAck.state, observedAt: this.clock() }), 'sync.cursor_acknowledged');
        if (rawAck.state === 'accepted') accepted += 1;
        else duplicate += 1;
      } else {
        const divergence = createSyncDivergence({
          workspaceId,
          sourceInstanceId: source.id,
          cursor: envelope.cursor,
          envelopeId: envelope.id,
          expectedDigest: envelope.envelopeDigest,
          observedDigest: rawAck.envelopeDigest || null,
          reasonCode: rawAck.reasonCode || 'remote_rejected',
          observedAt: this.clock(),
        });
        this.syncDivergence.save({ id: boundedId('syncdivergence', workspaceId, source.id, envelope.cursor, divergence.reasonCode), ...divergence }, 'sync.divergence_recorded');
        cursor = this.saveCursor(createSyncCursor({ ...publicRecord(cursor), status: 'divergent', updatedAt: this.clock() }), 'sync.cursor_divergent');
      }
    }
    return Object.freeze({ networkRequested: true, accepted, duplicate, cursor: publicRecord(cursor) });
  }

  async pullSharedMirror(input) {
    plainObject(input, 'S7 pull input');
    assertAllowedKeys(input, new Set(['workspaceId']), 'S7 pull input');
    const workspaceId = String(input.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const configuration = this.configurationFor(workspaceId);
    if (!configuration || configuration.status !== 'enabled') throw new Error('sync_not_enabled');
    if (!this.syncEndpoint || !this.syncTransport) throw new Error('sync_endpoint_unavailable');
    const localSourceId = this.activeSourceInstance().id;
    let response;
    try {
      response = await this.syncTransport.readMirror({ workspaceId, sinceCursor: 0 });
    } catch (error) {
      const current = this.cursorFor(workspaceId);
      this.saveCursor(createSyncCursor({ ...publicRecord(current), status: 'unavailable', updatedAt: this.clock() }), 'sync.transport_unavailable');
      throw error;
    }
    if (response?.workspaceId !== workspaceId) throw new Error('cross_workspace_mirror');
    let storedCount = 0;
    for (const source of response.sources || []) {
      if (!source?.sourceInstanceId || source.sourceInstanceId === localSourceId) continue;
      const records = [];
      for (const record of source.records || []) {
        if (record.workspaceId !== workspaceId) throw new Error('cross_workspace_mirror_record');
        if (record.sourceInstanceId !== source.sourceInstanceId) throw new Error('mirror_source_mismatch');
        records.push(Object.freeze({
          recordClass: record.recordClass,
          recordId: record.recordId,
          recordRevision: Number(record.recordRevision || 1),
          payload: assertCollaborationPayload(record.recordClass, record.payload),
        }));
      }
      const id = boundedId('syncmirror', workspaceId, source.sourceInstanceId);
      this.syncRemoteMirror.save({
        id,
        workspaceId,
        remoteSourceInstanceId: source.sourceInstanceId,
        syncCursor: Number(source.lastCursor || 0),
        syncStatus: 'current',
        records: Object.freeze(records),
        observedAt: this.clock(),
      }, 'sync.remote_mirror_pulled');
      storedCount += 1;
    }
    const current = this.cursorFor(workspaceId);
    this.saveCursor(createSyncCursor({ ...publicRecord(current), status: 'current', updatedAt: this.clock() }), 'sync.cursor_mirror_current');
    return Object.freeze({ networkRequested: true, remoteSourcesStored: storedCount });
  }

  querySharedWorkspace({ workspaceId, subjectId, remoteSourceInstanceId }) {
    this.requireS7Workspace(workspaceId);
    const membership = this.workspaceMembership.list().find((item) => item.workspaceId === workspaceId && item.subjectId === subjectId && item.status === 'active') || null;
    const mirror = this.syncRemoteMirror.list().find((item) => item.workspaceId === workspaceId && item.remoteSourceInstanceId === remoteSourceInstanceId) || null;
    if (!mirror) return Object.freeze({ found: false, workspaceId, reasonCode: 'remote_source_missing', remoteSourceInstanceId: null, syncCursor: null, syncStatus: null, records: Object.freeze([]), observedAt: null });
    return createSharedWorkspaceSnapshot(publicRecord(mirror), membership ? publicRecord(membership) : null);
  }

  querySyncState(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('workspaceId is required');
    const workspace = this.workspace.get(workspaceId);
    if (!workspace) return Object.freeze({
      workspaceId, found: false, configuration: null, sourceInstance: null, cursor: null,
      pendingEnvelopes: Object.freeze([]), remoteSources: Object.freeze([]), divergences: Object.freeze([]),
      memberships: Object.freeze([]), sharedWorkspaces: Object.freeze([]),
    });
    const source = this.activeSourceInstance();
    const cursor = this.cursorFor(workspaceId);
    const envelopes = this.syncEnvelope.list().filter((item) => item.workspaceId === workspaceId && item.sourceInstanceId === source.id);
    const pendingEnvelopes = envelopes.filter((item) => item.cursor > cursor.lastAcknowledgedCursor).sort((a, b) => a.cursor - b.cursor).map(publicEnvelope);
    const mirrors = this.syncRemoteMirror.list().filter((item) => item.workspaceId === workspaceId);
    const localMembership = this.localOperatorMembership(workspaceId);
    const sharedWorkspaces = localMembership
      ? mirrors.map((mirror) => createSharedWorkspaceSnapshot(publicRecord(mirror), publicRecord(localMembership))).filter((item) => item.found)
      : [];
    return Object.freeze({
      workspaceId,
      found: true,
      configuration: publicRecord(this.configurationFor(workspaceId)),
      sourceInstance: publicRecord(source),
      cursor: publicRecord(cursor),
      pendingEnvelopes: Object.freeze(pendingEnvelopes),
      remoteSources: Object.freeze(mirrors.map((item) => Object.freeze({ sourceInstanceId: item.remoteSourceInstanceId, lastCursor: item.syncCursor, status: item.syncStatus, observedAt: item.observedAt }))),
      divergences: Object.freeze(this.syncDivergence.list().filter((item) => item.workspaceId === workspaceId).map(publicRecord)),
      memberships: Object.freeze(this.workspaceMembership.list().filter((item) => item.workspaceId === workspaceId).map(publicRecord)),
      sharedWorkspaces: Object.freeze(sharedWorkspaces),
    });
  }

  queryOperatorCockpit(workspaceId) {
    const cockpit = super.queryOperatorCockpit(workspaceId);
    return Object.freeze({ ...cockpit, collaborationSync: this.querySyncState(workspaceId) });
  }
}

module.exports = {
  LOCAL_OPERATOR_SUBJECT,
  S7ApplicationService,
  SYNC_SCHEMA_VERSION,
  boundedId,
  publicEnvelope,
  publicRecord,
};
