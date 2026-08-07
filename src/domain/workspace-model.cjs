const { assertSafeIdentifier } = require('./identifiers.cjs');

function requiredText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new TypeError(`${label} must be non-empty text up to ${maxLength} characters`);
  }
  return value.trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function createProject(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'project id'),
    name: requiredText(input?.name, 'project name'),
    status: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
    updatedAt: input?.updatedAt || input?.createdAt || new Date().toISOString(),
  });
}

function createWorkspace(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'workspace id'),
    projectId: assertSafeIdentifier(input?.projectId, 'project id'),
    name: requiredText(input?.name, 'workspace name'),
    status: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
    updatedAt: input?.updatedAt || input?.createdAt || new Date().toISOString(),
  });
}

function archiveWorkspace(workspace, occurredAt = new Date().toISOString()) {
  assertWorkspace(workspace);
  if (workspace.status === 'archived') return workspace;
  return deepFreeze({ ...workspace, status: 'archived', updatedAt: occurredAt });
}

function assertWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object') throw new TypeError('workspace is required');
  assertSafeIdentifier(workspace.id, 'workspace id');
  if (!['active', 'archived'].includes(workspace.status)) throw new Error('Unsupported workspace status');
  return workspace;
}

function assertWorkspaceActive(workspace) {
  assertWorkspace(workspace);
  if (workspace.status !== 'active') throw new Error(`Workspace is not active: ${workspace.id}`);
  return workspace;
}

function assertWorkspaceId(expectedWorkspaceId, ...records) {
  const expected = assertSafeIdentifier(expectedWorkspaceId, 'workspace id');
  for (const record of records) {
    if (!record || record.workspaceId !== expected) throw new Error('Cross-Workspace reference denied');
  }
  return expected;
}

module.exports = {
  archiveWorkspace,
  assertWorkspace,
  assertWorkspaceActive,
  assertWorkspaceId,
  createProject,
  createWorkspace,
  deepFreeze,
  requiredText,
};
