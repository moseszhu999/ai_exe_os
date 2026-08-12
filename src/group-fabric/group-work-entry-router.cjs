'use strict';

const { createHash } = require('node:crypto');
const {
  GROUP_AUTONOMY_POLICY_SCHEMA,
  GROUP_WORK_ENTRY_SCHEMA,
  createGroupDecisionEscalation,
} = require('./group-operating-system.cjs');

const GROUP_WORK_ROUTE_SCHEMA = 'group.work-route.v1';
const GROUP_OWNER_DECISION_ITEM_SCHEMA = 'group.owner-decision-item.v1';
const ROUTE_STATES = Object.freeze(['matched', 'needs_human_review', 'blocked']);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  }
}

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} must be a bounded non-empty string`);
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeRef(value, label, prefix = null) {
  const normalized = text(value, label, 260);
  if (prefix && !normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: normalized, time };
}

function uniqueRefs(value, label, prefix = 'evidence:', min = 1, max = 64) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const refs = value.map((item) => safeRef(item, label, prefix));
  if (new Set(refs).size !== refs.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze([...refs].sort());
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function noAuthorityFlags() {
  return {
    authorizationDecisionCreated: false,
    authorityGrantCreated: false,
    humanGateDecisionCreated: false,
    delegationCreated: false,
    executionAuthorized: false,
    domainTruthCreated: false,
    domainWritePerformed: false,
    externalActionPerformed: false,
  };
}

function assertNoAuthorityFlags(value, label) {
  for (const [key, expected] of Object.entries(noAuthorityFlags())) {
    if (value[key] !== expected) throw new TypeError(`${label} truth boundary widened: ${key}`);
  }
}

function assertDigestObject(value, schema, digestField, label) {
  plainObject(value, label);
  if (value.schema !== schema) throw new TypeError(`${label} schema mismatch`);
  const actual = value[digestField];
  const unsigned = { ...value };
  delete unsigned[digestField];
  if (typeof actual !== 'string' || actual !== digest(unsigned)) throw new TypeError(`${label} digest mismatch`);
  assertNoAuthorityFlags(value, label);
  return value;
}

function assertWorkEntry(workEntry) {
  assertDigestObject(workEntry, GROUP_WORK_ENTRY_SCHEMA, 'entryDigest', 'work entry');
  if (workEntry.routingProposalOnly !== true || workEntry.managerMayMintDomainTruth !== false) {
    throw new TypeError('work entry manager boundary drift');
  }
  return workEntry;
}

function assertPolicy(policy) {
  assertDigestObject(policy, GROUP_AUTONOMY_POLICY_SCHEMA, 'policyDigest', 'autonomy policy');
  if (policy.policyOnly !== true || policy.autonomyPromotionPerformed !== false) {
    throw new TypeError('autonomy policy control flags are invalid');
  }
  return policy;
}

function isActivePolicy(policy, observedTime) {
  const validFrom = Date.parse(policy.validFrom);
  const validUntil = Date.parse(policy.validUntil);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil)) throw new TypeError('autonomy policy validity window is invalid');
  return observedTime >= validFrom && observedTime < validUntil;
}

function normalizePolicies(policies) {
  if (!Array.isArray(policies) || policies.length > 256) throw new TypeError('policies must be a bounded array');
  const normalized = policies.map(assertPolicy);
  const identities = new Set();
  for (const policy of normalized) {
    const key = `${policy.policyRef}:${policy.policyDigest}`;
    if (identities.has(key)) throw new TypeError('policies must not contain duplicate policy identities');
    identities.add(key);
  }
  return Object.freeze([...normalized].sort((left, right) => (
    left.actionCode.localeCompare(right.actionCode)
    || left.ownerDomain.localeCompare(right.ownerDomain)
    || left.policyRef.localeCompare(right.policyRef)
    || left.policyDigest.localeCompare(right.policyDigest)
  )));
}

function normalizeManagerSuggestion(input, activePolicies, workEntry, observedAt) {
  if (input === undefined || input === null) return null;
  plainObject(input, 'manager suggestion');
  assertAllowedKeys(input, new Set([
    'suggestionRef', 'suggestedActionCode', 'suggestedDomain', 'rationaleCode',
    'evidenceRefs', 'modelRef', 'generatedAt',
  ]), 'manager suggestion');

  const suggestedActionCode = safeCode(input.suggestedActionCode, 'suggestedActionCode');
  const suggestedDomain = safeCode(input.suggestedDomain, 'suggestedDomain');
  const candidates = activePolicies.filter((policy) => (
    policy.actionCode === suggestedActionCode && policy.ownerDomain === suggestedDomain
  ));
  if (candidates.length !== 1) {
    throw new TypeError('manager suggestion must resolve to exactly one active existing policy candidate');
  }

  const generatedAt = timestamp(input.generatedAt, 'generatedAt');
  if (generatedAt.time > observedAt.time) throw new TypeError('manager suggestion cannot be generated after route observation');

  const candidate = candidates[0];
  return freezeDeep({
    suggestionRef: safeRef(input.suggestionRef, 'suggestionRef', 'group:route-suggestion:'),
    sourceWorkEntryRef: workEntry.entryRef,
    sourceWorkEntryDigest: workEntry.entryDigest,
    suggestedActionCode,
    suggestedDomain,
    candidatePolicyRef: candidate.policyRef,
    candidatePolicyDigest: candidate.policyDigest,
    rationaleCode: safeCode(input.rationaleCode, 'rationaleCode'),
    evidenceRefs: uniqueRefs(input.evidenceRefs, 'manager suggestion evidenceRefs'),
    modelRef: safeRef(input.modelRef, 'modelRef', 'model:'),
    generatedAt: generatedAt.text,
    proposalOnly: true,
    applied: false,
    ownerApprovalRequired: true,
    managerMayMintDomainTruth: false,
    ...noAuthorityFlags(),
  });
}

function routeGroupWorkEntry(input) {
  plainObject(input, 'group work route input');
  assertAllowedKeys(input, new Set([
    'routeRef', 'workEntry', 'policies', 'routeEvidenceRefs', 'observedAt', 'managerSuggestion',
  ]), 'group work route input');

  const workEntry = assertWorkEntry(input.workEntry);
  const policies = normalizePolicies(input.policies);
  const observedAt = timestamp(input.observedAt, 'observedAt');
  const routeEvidenceRefs = uniqueRefs(input.routeEvidenceRefs, 'routeEvidenceRefs');
  const activePolicies = policies.filter((policy) => isActivePolicy(policy, observedAt.time));
  const exactPolicies = activePolicies.filter((policy) => policy.actionCode === workEntry.requestedActionCode);

  let routeState = 'needs_human_review';
  let reasonCode = 'no_active_policy_match';
  let selectedPolicy = null;
  let escalation = null;
  let managementIntakeEligible = false;
  let ownerAttentionRequired = true;
  let managerFallbackEligible = true;

  if (exactPolicies.length > 1) {
    routeState = 'blocked';
    reasonCode = 'conflicting_active_policies';
    managerFallbackEligible = false;
  } else if (exactPolicies.length === 1) {
    selectedPolicy = exactPolicies[0];
    managerFallbackEligible = false;
    escalation = createGroupDecisionEscalation({
      escalationRef: `group:decision-escalation:route-${safeRef(input.routeRef, 'routeRef', 'group:work-route:').slice('group:work-route:'.length)}`,
      workEntry,
      policy: selectedPolicy,
      routeStatus: 'matched',
      routeReasonCode: 'exact_active_policy_match',
      routeEvidenceRefs,
      observedAt: observedAt.text,
    });

    if (escalation.decisionState === 'ready_for_bounded_processing') {
      routeState = 'matched';
      reasonCode = 'exact_active_policy_match';
      managementIntakeEligible = true;
      ownerAttentionRequired = false;
    } else if (escalation.decisionState === 'needs_human_review') {
      routeState = 'needs_human_review';
      reasonCode = selectedPolicy.humanGateRequired
        ? 'matched_policy_requires_human_review'
        : escalation.reasonCode;
    } else {
      routeState = 'blocked';
      reasonCode = escalation.reasonCode;
    }
  }

  const managerSuggestion = normalizeManagerSuggestion(input.managerSuggestion, activePolicies, workEntry, observedAt);
  if (managerSuggestion && !managerFallbackEligible) {
    throw new TypeError('manager suggestion is allowed only when deterministic routing has no active policy match');
  }
  if (managerSuggestion) reasonCode = 'manager_classification_proposal_available';

  const unsigned = {
    schema: GROUP_WORK_ROUTE_SCHEMA,
    routeRef: safeRef(input.routeRef, 'routeRef', 'group:work-route:'),
    workEntryRef: workEntry.entryRef,
    workEntryDigest: workEntry.entryDigest,
    requestedActionCode: workEntry.requestedActionCode,
    requestedDomain: workEntry.requestedDomain,
    routeState,
    reasonCode,
    selectedPolicyRef: selectedPolicy ? selectedPolicy.policyRef : null,
    selectedPolicyDigest: selectedPolicy ? selectedPolicy.policyDigest : null,
    ownerDomain: selectedPolicy ? selectedPolicy.ownerDomain : null,
    autonomyLevel: selectedPolicy ? selectedPolicy.autonomyLevel : null,
    decisionEscalationRef: escalation ? escalation.escalationRef : null,
    decisionEscalationDigest: escalation ? escalation.escalationDigest : null,
    managementIntakeEligible,
    ownerAttentionRequired,
    managerFallbackEligible,
    managerSuggestion,
    managerSuggestionApplied: false,
    deterministicPolicyRoutingFirst: true,
    routeEvidenceRefs,
    observedAt: observedAt.text,
    routeProposalOnly: true,
    ...noAuthorityFlags(),
  };

  if (!ROUTE_STATES.includes(routeState)) throw new TypeError('routeState is unsupported');
  return freezeDeep({ ...unsigned, routeDigest: digest(unsigned) });
}

function assertRouteResult(routeResult) {
  assertDigestObject(routeResult, GROUP_WORK_ROUTE_SCHEMA, 'routeDigest', 'group work route');
  if (!ROUTE_STATES.includes(routeResult.routeState)) throw new TypeError('group work route state is unsupported');
  if (routeResult.routeProposalOnly !== true || routeResult.managerSuggestionApplied !== false) {
    throw new TypeError('group work route proposal boundary drift');
  }
  if (routeResult.managementIntakeEligible === true && routeResult.routeState !== 'matched') {
    throw new TypeError('only a matched route can be eligible for management intake');
  }
  return routeResult;
}

function createOwnerDecisionItem(input) {
  plainObject(input, 'owner decision item input');
  assertAllowedKeys(input, new Set(['itemRef', 'routeResult', 'createdAt', 'evidenceRefs']), 'owner decision item input');
  const routeResult = assertRouteResult(input.routeResult);
  if (routeResult.ownerAttentionRequired !== true) throw new TypeError('owner decision item requires owner attention');

  let priority = 'normal';
  if (routeResult.routeState === 'blocked') priority = 'high';
  if (routeResult.autonomyLevel === 'L4') priority = 'critical';

  const suggestion = routeResult.managerSuggestion;
  const unsigned = {
    schema: GROUP_OWNER_DECISION_ITEM_SCHEMA,
    itemRef: safeRef(input.itemRef, 'itemRef', 'group:owner-decision:'),
    routeRef: routeResult.routeRef,
    routeDigest: routeResult.routeDigest,
    workEntryRef: routeResult.workEntryRef,
    workEntryDigest: routeResult.workEntryDigest,
    requestedActionCode: routeResult.requestedActionCode,
    routeState: routeResult.routeState,
    reasonCode: routeResult.reasonCode,
    ownerDomain: routeResult.ownerDomain,
    autonomyLevel: routeResult.autonomyLevel,
    priority,
    suggestedActionCode: suggestion ? suggestion.suggestedActionCode : null,
    suggestedDomain: suggestion ? suggestion.suggestedDomain : null,
    candidatePolicyRef: suggestion ? suggestion.candidatePolicyRef : null,
    evidenceRefs: uniqueRefs(input.evidenceRefs, 'owner decision evidenceRefs'),
    createdAt: timestamp(input.createdAt, 'createdAt').text,
    decisionNeeded: true,
    approvalRecorded: false,
    rejectionRecorded: false,
    decisionItemOnly: true,
    ...noAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, itemDigest: digest(unsigned) });
}

module.exports = {
  GROUP_OWNER_DECISION_ITEM_SCHEMA,
  GROUP_WORK_ROUTE_SCHEMA,
  ROUTE_STATES,
  createOwnerDecisionItem,
  routeGroupWorkEntry,
};
