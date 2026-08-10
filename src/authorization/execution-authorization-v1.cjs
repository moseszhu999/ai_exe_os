'use strict';

const { createHash } = require('node:crypto');

const TOP_LEVEL_KEYS = Object.freeze([
  'schema', 'requestRef', 'organizationRef', 'actorRef', 'actorKind',
  'requestedActionRef', 'action', 'targetRef', 'observedAt', 'requirements', 'resolved',
]);
const REQUIREMENT_KEYS = Object.freeze([
  'requiredHumanCapabilityRefs', 'requiredAgentCapabilityRefs', 'requiredEvidenceRefs',
  'requiredPolicyRefs', 'humanGateRequired',
]);
const RESOLVED_KEYS = Object.freeze([
  'authorityGrant', 'delegation', 'humanCapabilityCredentials', 'agentCapabilityPackages',
  'evidence', 'policies', 'humanGate', 'revocations',
]);
const AUTHORITY_KEYS = Object.freeze([
  'ref', 'status', 'organizationRef', 'actorRef', 'allowedActions', 'allowedTargets', 'expiresAt',
]);
const CREDENTIAL_KEYS = Object.freeze(['ref', 'capabilityRef', 'status', 'eligibility']);
const PACKAGE_KEYS = Object.freeze(['ref', 'status']);
const EVIDENCE_KEYS = Object.freeze(['ref', 'status']);
const POLICY_KEYS = Object.freeze(['ref', 'status']);
const HUMAN_GATE_KEYS = Object.freeze(['ref', 'state']);
const REVOCATION_KEYS = Object.freeze(['ref', 'subjectRef', 'status']);
const FORBIDDEN_INPUT_KEYS = new Set([
  'allow', 'approved', 'authorized', 'authorizationDecision', 'decision',
  'executionAuthorized', 'authorityGranted', 'force', 'bypass', 'skipHumanGate',
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function strictKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${label} contains unknown field: ${unknown.sort()[0]}`);
}

function rejectSelfAuthorizationKeys(value, path = 'input') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSelfAuthorizationKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(key)) throw new TypeError(`${path}.${key} is forbidden self-authorization input`);
    rejectSelfAuthorizationKeys(nested, `${path}.${key}`);
  }
}

function text(value, label, max = 300) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new TypeError(`${label} is invalid`);
  return cleaned;
}

function iso(value, label) {
  const cleaned = text(value, label, 64);
  const ms = Date.parse(cleaned);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} must be ISO-compatible`);
  return Object.freeze({ value: cleaned, ms });
}

function uniqueRefs(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const normalized = values.map((value, index) => text(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} contains duplicates`);
  return Object.freeze([...normalized].sort());
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizeAuthority(value, label) {
  if (value == null) return null;
  strictKeys(value, AUTHORITY_KEYS, label);
  return Object.freeze({
    ref: text(value.ref, `${label}.ref`),
    status: text(value.status, `${label}.status`, 40),
    organizationRef: text(value.organizationRef, `${label}.organizationRef`),
    actorRef: text(value.actorRef, `${label}.actorRef`),
    allowedActions: uniqueRefs(value.allowedActions, `${label}.allowedActions`),
    allowedTargets: uniqueRefs(value.allowedTargets, `${label}.allowedTargets`),
    expiresAt: value.expiresAt == null ? null : iso(value.expiresAt, `${label}.expiresAt`).value,
  });
}

function normalizeList(values, keys, label, mapper) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  return Object.freeze(values.map((value, index) => {
    strictKeys(value, keys, `${label}[${index}]`);
    return Object.freeze(mapper(value, index));
  }));
}

function normalizeInput(input) {
  rejectSelfAuthorizationKeys(input);
  strictKeys(input, TOP_LEVEL_KEYS, 'input');
  if (input.schema !== 'execution.authorization.request.v1') throw new TypeError('unsupported authorization request schema');
  const observed = iso(input.observedAt, 'observedAt');
  if (!['human', 'agent'].includes(input.actorKind)) throw new TypeError('actorKind must be human or agent');
  strictKeys(input.requirements, REQUIREMENT_KEYS, 'requirements');
  strictKeys(input.resolved, RESOLVED_KEYS, 'resolved');
  if (typeof input.requirements.humanGateRequired !== 'boolean') throw new TypeError('requirements.humanGateRequired must be boolean');

  const humanCapabilityCredentials = normalizeList(
    input.resolved.humanCapabilityCredentials, CREDENTIAL_KEYS, 'resolved.humanCapabilityCredentials',
    (value, index) => ({
      ref: text(value.ref, `resolved.humanCapabilityCredentials[${index}].ref`),
      capabilityRef: text(value.capabilityRef, `resolved.humanCapabilityCredentials[${index}].capabilityRef`),
      status: text(value.status, `resolved.humanCapabilityCredentials[${index}].status`, 40),
      eligibility: text(value.eligibility, `resolved.humanCapabilityCredentials[${index}].eligibility`, 60),
    }),
  );
  const agentCapabilityPackages = normalizeList(
    input.resolved.agentCapabilityPackages, PACKAGE_KEYS, 'resolved.agentCapabilityPackages',
    (value, index) => ({ ref: text(value.ref, `resolved.agentCapabilityPackages[${index}].ref`), status: text(value.status, `resolved.agentCapabilityPackages[${index}].status`, 40) }),
  );
  const evidence = normalizeList(
    input.resolved.evidence, EVIDENCE_KEYS, 'resolved.evidence',
    (value, index) => ({ ref: text(value.ref, `resolved.evidence[${index}].ref`), status: text(value.status, `resolved.evidence[${index}].status`, 40) }),
  );
  const policies = normalizeList(
    input.resolved.policies, POLICY_KEYS, 'resolved.policies',
    (value, index) => ({ ref: text(value.ref, `resolved.policies[${index}].ref`), status: text(value.status, `resolved.policies[${index}].status`, 40) }),
  );
  const revocations = normalizeList(
    input.resolved.revocations, REVOCATION_KEYS, 'resolved.revocations',
    (value, index) => ({
      ref: text(value.ref, `resolved.revocations[${index}].ref`),
      subjectRef: text(value.subjectRef, `resolved.revocations[${index}].subjectRef`),
      status: text(value.status, `resolved.revocations[${index}].status`, 40),
    }),
  );

  let humanGate = null;
  if (input.resolved.humanGate != null) {
    strictKeys(input.resolved.humanGate, HUMAN_GATE_KEYS, 'resolved.humanGate');
    humanGate = Object.freeze({
      ref: text(input.resolved.humanGate.ref, 'resolved.humanGate.ref'),
      state: text(input.resolved.humanGate.state, 'resolved.humanGate.state', 40),
    });
  }

  return deepFreeze({
    schema: input.schema,
    requestRef: text(input.requestRef, 'requestRef'),
    organizationRef: text(input.organizationRef, 'organizationRef'),
    actorRef: text(input.actorRef, 'actorRef'),
    actorKind: input.actorKind,
    requestedActionRef: text(input.requestedActionRef, 'requestedActionRef'),
    action: text(input.action, 'action', 160),
    targetRef: text(input.targetRef, 'targetRef'),
    observedAt: observed.value,
    observedAtMs: observed.ms,
    requirements: {
      requiredHumanCapabilityRefs: uniqueRefs(input.requirements.requiredHumanCapabilityRefs, 'requirements.requiredHumanCapabilityRefs'),
      requiredAgentCapabilityRefs: uniqueRefs(input.requirements.requiredAgentCapabilityRefs, 'requirements.requiredAgentCapabilityRefs'),
      requiredEvidenceRefs: uniqueRefs(input.requirements.requiredEvidenceRefs, 'requirements.requiredEvidenceRefs'),
      requiredPolicyRefs: uniqueRefs(input.requirements.requiredPolicyRefs, 'requirements.requiredPolicyRefs'),
      humanGateRequired: input.requirements.humanGateRequired,
    },
    resolved: {
      authorityGrant: normalizeAuthority(input.resolved.authorityGrant, 'resolved.authorityGrant'),
      delegation: normalizeAuthority(input.resolved.delegation, 'resolved.delegation'),
      humanCapabilityCredentials,
      agentCapabilityPackages,
      evidence,
      policies,
      humanGate,
      revocations,
    },
  });
}

function authorityState(authority, input, prefix, verified, missing) {
  if (!authority) {
    missing.add(`${prefix}:missing`);
    return 'unknown';
  }
  verified.add(authority.ref);
  if (authority.status === 'revoked' || authority.status === 'rejected' || authority.status === 'expired' || authority.status === 'suspended') return 'deny';
  if (authority.status !== 'active') return 'unknown';
  if (authority.organizationRef !== input.organizationRef || authority.actorRef !== input.actorRef) return 'deny';
  if (!authority.allowedActions.includes(input.action) || !authority.allowedTargets.includes(input.targetRef)) return 'deny';
  if (authority.expiresAt && Date.parse(authority.expiresAt) <= input.observedAtMs) return 'deny';
  return 'pass';
}

function evaluateExecutionAuthorizationV1(rawInput) {
  const input = normalizeInput(rawInput);
  const verified = new Set();
  const missing = new Set();
  const denyReasons = new Set();
  const unknownReasons = new Set();
  const reviewReasons = new Set();

  const grantState = authorityState(input.resolved.authorityGrant, input, 'authorityGrant', verified, missing);
  if (grantState === 'deny') denyReasons.add('authority_grant_denied');
  if (grantState === 'unknown') unknownReasons.add('authority_grant_unknown');

  if (input.actorKind === 'agent') {
    const delegationState = authorityState(input.resolved.delegation, input, 'delegation', verified, missing);
    if (delegationState === 'deny') denyReasons.add('delegation_denied');
    if (delegationState === 'unknown') unknownReasons.add('delegation_unknown');
  } else if (input.resolved.delegation) {
    verified.add(input.resolved.delegation.ref);
  }

  const revokedSubjects = input.resolved.revocations.filter((entry) => entry.status === 'revoked');
  for (const entry of input.resolved.revocations) verified.add(entry.ref);
  if (revokedSubjects.some((entry) => [input.actorRef, input.resolved.authorityGrant?.ref, input.resolved.delegation?.ref].includes(entry.subjectRef))) {
    denyReasons.add('revocation_active');
  }

  if (input.actorKind === 'human') {
    const eligibleCapabilities = new Set(input.resolved.humanCapabilityCredentials
      .filter((credential) => credential.status === 'valid' && credential.eligibility === 'eligible_prerequisite')
      .map((credential) => credential.capabilityRef));
    for (const credential of input.resolved.humanCapabilityCredentials) verified.add(credential.ref);
    for (const capabilityRef of input.requirements.requiredHumanCapabilityRefs) {
      if (!eligibleCapabilities.has(capabilityRef)) {
        missing.add(capabilityRef);
        unknownReasons.add('human_capability_prerequisite_unknown');
      }
    }
    if (input.requirements.requiredAgentCapabilityRefs.length) {
      unknownReasons.add('agent_capability_binding_unknown');
      input.requirements.requiredAgentCapabilityRefs.forEach((ref) => missing.add(ref));
    }
  } else {
    const acceptedPackages = new Set(input.resolved.agentCapabilityPackages.filter((pkg) => pkg.status === 'accepted').map((pkg) => pkg.ref));
    for (const pkg of input.resolved.agentCapabilityPackages) verified.add(pkg.ref);
    for (const capabilityRef of input.requirements.requiredAgentCapabilityRefs) {
      if (!acceptedPackages.has(capabilityRef)) {
        missing.add(capabilityRef);
        unknownReasons.add('agent_capability_prerequisite_unknown');
      }
    }
    if (input.requirements.requiredHumanCapabilityRefs.length) {
      unknownReasons.add('human_capability_binding_unknown');
      input.requirements.requiredHumanCapabilityRefs.forEach((ref) => missing.add(ref));
    }
  }

  const evidenceByRef = new Map(input.resolved.evidence.map((entry) => [entry.ref, entry]));
  for (const entry of input.resolved.evidence) verified.add(entry.ref);
  for (const ref of input.requirements.requiredEvidenceRefs) {
    const entry = evidenceByRef.get(ref);
    if (!entry || entry.status !== 'current') {
      missing.add(ref);
      unknownReasons.add('required_evidence_unknown');
    }
  }

  const policyByRef = new Map(input.resolved.policies.map((entry) => [entry.ref, entry]));
  for (const entry of input.resolved.policies) verified.add(entry.ref);
  for (const ref of input.requirements.requiredPolicyRefs) {
    const entry = policyByRef.get(ref);
    if (!entry || !['accepted', 'current'].includes(entry.status)) {
      missing.add(ref);
      if (entry && ['rejected', 'revoked'].includes(entry.status)) denyReasons.add('required_policy_denied');
      else unknownReasons.add('required_policy_unknown');
    }
  }

  if (input.requirements.humanGateRequired) {
    const gate = input.resolved.humanGate;
    if (!gate || gate.state === 'requested') {
      if (gate) verified.add(gate.ref);
      reviewReasons.add('human_gate_required');
      if (!gate) missing.add('humanGate:missing');
    } else {
      verified.add(gate.ref);
      if (gate.state !== 'approved') denyReasons.add('human_gate_denied');
    }
  } else if (input.resolved.humanGate) {
    verified.add(input.resolved.humanGate.ref);
  }

  let decision = 'allow';
  let reasons = [];
  if (denyReasons.size) {
    decision = 'deny';
    reasons = [...denyReasons].sort();
  } else if (reviewReasons.size) {
    decision = 'needs_human_review';
    reasons = [...reviewReasons].sort();
  } else if (unknownReasons.size || missing.size) {
    decision = 'unknown';
    reasons = [...unknownReasons].sort();
  }

  const expiries = [input.resolved.authorityGrant?.expiresAt, input.actorKind === 'agent' ? input.resolved.delegation?.expiresAt : null]
    .filter(Boolean)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const validUntil = expiries[0] || null;
  const digestInput = canonical({ ...input, observedAtMs: undefined });
  delete digestInput.observedAtMs;
  const requestDigest = sha256(digestInput);
  const decisionCore = {
    schema: 'execution.authorization.v1',
    requestRef: input.requestRef,
    organizationRef: input.organizationRef,
    actorRef: input.actorRef,
    actorKind: input.actorKind,
    requestedActionRef: input.requestedActionRef,
    decision,
    reasonCodes: reasons,
    verifiedPrerequisiteRefs: [...verified].sort(),
    missingPrerequisiteRefs: [...missing].sort(),
    observedAt: input.observedAt,
    validUntil,
    requestDigest,
    authorityGrantCreated: false,
    humanGateDecisionCreated: false,
    delegationCreated: false,
    executionPerformed: false,
    externalActionPerformed: false,
  };
  const decisionEvidenceDigest = sha256(decisionCore);
  return deepFreeze({
    ...decisionCore,
    decisionRef: `execauth_${decisionEvidenceDigest.slice(0, 24)}`,
    decisionEvidenceDigest,
  });
}

module.exports = {
  evaluateExecutionAuthorizationV1,
};
