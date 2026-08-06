'use strict';

const BLOCKER_CODES = Object.freeze([
  'workspace_inactive',
  'agent_inactive',
  'installation_missing_or_disabled',
  'grant_missing_or_revoked',
  'action_or_target_not_granted',
  'provider_contract_unknown',
  'provider_contract_changed_or_expired',
  'dependency_unsatisfied',
  'resource_conflict',
  'human_gate_required',
  'recovery_requires_review',
]);

function blocker(code, detail = null) {
  if (!BLOCKER_CODES.includes(code)) throw new Error(`Unknown blocker code: ${code}`);
  return Object.freeze({ code, detail });
}

function evaluateExecutionReadiness(input) {
  if (!input || typeof input !== 'object') throw new TypeError('readiness input is required');
  const blockers = [];
  const { workspace, agent, installation, grant, task, providerSnapshot } = input;
  if (!workspace || workspace.status !== 'active') blockers.push(blocker('workspace_inactive'));
  if (!agent || agent.status !== 'active' || agent.workspaceId !== workspace?.id) blockers.push(blocker('agent_inactive'));
  if (!installation || installation.status !== 'installed' || installation.workspaceId !== workspace?.id) {
    blockers.push(blocker('installation_missing_or_disabled'));
  }
  if (!grant || grant.status !== 'active' || grant.workspaceId !== workspace?.id
    || grant.agentId !== agent?.id || grant.installationId !== installation?.id) {
    blockers.push(blocker('grant_missing_or_revoked'));
  } else if (!task || !grant.allowedActions?.includes(task.capabilityAction)
    || !grant.allowedTargets?.includes(task.target)) {
    blockers.push(blocker('action_or_target_not_granted'));
  }
  if (!providerSnapshot || providerSnapshot.status !== 'accepted') {
    blockers.push(blocker('provider_contract_unknown'));
  } else {
    const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
    const changed = input.currentProviderDigest
      && input.currentProviderDigest !== providerSnapshot.snapshotDigest;
    if (changed || Date.parse(providerSnapshot.expiresAt) <= now.getTime()) {
      blockers.push(blocker('provider_contract_changed_or_expired'));
    }
  }
  if (input.dependenciesReady === false) blockers.push(blocker('dependency_unsatisfied'));
  if (Array.isArray(input.resourceConflicts) && input.resourceConflicts.length > 0) {
    blockers.push(blocker('resource_conflict', [...input.resourceConflicts]));
  }
  if (input.recoveryRequired === true) blockers.push(blocker('recovery_requires_review'));
  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    requiresHumanGate: input.humanGatePolicy !== 'never',
  });
}

module.exports = { BLOCKER_CODES, evaluateExecutionReadiness };
