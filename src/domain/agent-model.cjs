'use strict';

const { assertSafeIdentifier } = require('./identifiers.cjs');
const { assertInstallationUsable } = require('./capability-model.cjs');
const { assertWorkspaceActive, assertWorkspaceId, deepFreeze, requiredText } = require('./workspace-model.cjs');

function createAgent({ id, workspace, name, role, createdAt = new Date().toISOString() }) {
  assertWorkspaceActive(workspace);
  return deepFreeze({
    id: assertSafeIdentifier(id, 'agent id'),
    workspaceId: workspace.id,
    name: requiredText(name, 'agent name'),
    role: requiredText(role, 'agent role', 100),
    status: 'active',
    createdAt,
  });
}

function disableAgent(agent) {
  if (!agent || typeof agent !== 'object') throw new TypeError('agent is required');
  if (agent.status === 'disabled') return agent;
  return deepFreeze({ ...agent, status: 'disabled' });
}

function createAgentCapabilityGrant({ id, workspace, agent, installation, allowedActions, allowedTargets, grantedAt = new Date().toISOString() }) {
  assertWorkspaceActive(workspace);
  assertWorkspaceId(workspace.id, agent, installation);
  if (agent.status !== 'active') throw new Error('Agent is not active');
  assertInstallationUsable(installation);
  const actions = normalizeList(allowedActions, 'allowed action', true);
  const targets = normalizeList(allowedTargets, 'allowed target', false);
  if (actions.length === 0 || targets.length === 0) throw new Error('Grant requires at least one action and target');
  return deepFreeze({
    id: assertSafeIdentifier(id, 'grant id'),
    workspaceId: workspace.id,
    agentId: agent.id,
    installationId: installation.id,
    allowedActions: actions,
    allowedTargets: targets,
    status: 'active',
    grantedAt,
  });
}

function normalizeList(values, label, identifiers) {
  if (!Array.isArray(values)) throw new TypeError(`${label}s must be an array`);
  const normalized = values.map((value) => identifiers
    ? assertSafeIdentifier(value, label)
    : requiredText(value, label, 500));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label}s must be unique`);
  return normalized;
}

function revokeGrant(grant) {
  if (!grant || typeof grant !== 'object') throw new TypeError('grant is required');
  if (grant.status === 'revoked') return grant;
  return deepFreeze({ ...grant, status: 'revoked' });
}

function assertGrantAllows({ workspace, agent, installation, grant, action, target }) {
  assertWorkspaceActive(workspace);
  assertWorkspaceId(workspace.id, agent, installation, grant);
  if (agent.status !== 'active') throw new Error('Agent is not active');
  assertInstallationUsable(installation);
  if (grant.status !== 'active') throw new Error('Agent capability grant is missing or revoked');
  if (grant.agentId !== agent.id || grant.installationId !== installation.id) {
    throw new Error('Grant does not bind this Agent and installation');
  }
  const normalizedAction = assertSafeIdentifier(action, 'capability action');
  const normalizedTarget = requiredText(target, 'capability target', 500);
  if (!grant.allowedActions.includes(normalizedAction)) throw new Error('Capability action is not granted');
  if (!grant.allowedTargets.includes(normalizedTarget)) throw new Error('Capability target is not granted');
  return true;
}

module.exports = { assertGrantAllows, createAgent, createAgentCapabilityGrant, disableAgent, revokeGrant };
