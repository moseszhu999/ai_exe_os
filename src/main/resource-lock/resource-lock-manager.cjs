'use strict';

function normalizeResource(resource) {
  if (!resource || typeof resource !== 'object') throw new TypeError('resource is required');
  const type = String(resource.type || '').trim();
  const key = String(resource.key || '').trim();
  if (!type || !key) throw new TypeError('resource type and key are required');
  return Object.freeze({ type, key, normalizedKey: `${type}:${key}` });
}

class ResourceConflictError extends Error {
  constructor(conflicts) {
    super(`Resource conflict: ${conflicts.map((item) => item.normalizedKey).join(', ')}`);
    this.name = 'ResourceConflictError';
    this.conflicts = conflicts;
  }
}

class ResourceLockManager {
  constructor() {
    this.locks = new Map();
  }

  conflicts(resources, executionRunId = null) {
    return resources.map(normalizeResource).filter((resource) => {
      const held = this.locks.get(resource.normalizedKey);
      return held && held.executionRunId !== executionRunId;
    });
  }

  acquireAll({ workspaceId, taskId, executionRunId, resources, acquiredAt = new Date().toISOString() }) {
    if (!workspaceId || !taskId || !executionRunId) throw new TypeError('workspaceId, taskId and executionRunId are required');
    if (!Array.isArray(resources) || resources.length === 0) throw new TypeError('resources are required');
    const normalized = resources.map(normalizeResource)
      .sort((left, right) => left.normalizedKey.localeCompare(right.normalizedKey));
    const duplicate = normalized.find((resource, index) => index > 0
      && resource.normalizedKey === normalized[index - 1].normalizedKey);
    if (duplicate) throw new Error(`Duplicate requested resource: ${duplicate.normalizedKey}`);
    const conflicts = this.conflicts(normalized, executionRunId);
    if (conflicts.length) throw new ResourceConflictError(conflicts);
    const acquired = normalized.map((resource) => Object.freeze({
      id: `${executionRunId}:${resource.normalizedKey}`,
      workspaceId,
      taskId,
      executionRunId,
      resourceType: resource.type,
      resourceKey: resource.key,
      normalizedKey: resource.normalizedKey,
      acquiredAt,
      releasedAt: null,
    }));
    for (const lock of acquired) this.locks.set(lock.normalizedKey, lock);
    return Object.freeze(acquired);
  }

  releaseAll(executionRunId, releasedAt = new Date().toISOString()) {
    const released = [];
    for (const [key, lock] of this.locks.entries()) {
      if (lock.executionRunId !== executionRunId) continue;
      released.push(Object.freeze({ ...lock, releasedAt }));
      this.locks.delete(key);
    }
    return Object.freeze(released);
  }

  list() {
    return Object.freeze([...this.locks.values()]);
  }
}

module.exports = { ResourceConflictError, ResourceLockManager, normalizeResource };
