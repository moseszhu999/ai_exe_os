'use strict';

class ProjectionRepository {
  constructor({ store, projectionType, defaultWorkspaceId = 'system' }) {
    if (!store || !projectionType) throw new TypeError('store and projectionType are required');
    this.store = store;
    this.projectionType = projectionType;
    this.defaultWorkspaceId = defaultWorkspaceId;
    this.records = new Map();
    for (const projection of store.listProjections({ projectionType })) {
      this.records.set(projection.projectionId, Object.freeze({ ...projection.data }));
    }
  }

  get(id) { return this.records.get(id) || null; }
  list() { return [...this.records.values()]; }

  save(record, reason = 'snapshot') {
    if (!record || typeof record !== 'object' || !record.id) throw new TypeError(`${this.projectionType} record id is required`);
    const current = this.store.getProjection(this.projectionType, record.id);
    const version = (current?.version || 0) + 1;
    const stored = Object.freeze({ ...structuredClone(record), _revision: version });
    const workspaceId = stored.workspaceId || this.defaultWorkspaceId;
    this.store.appendWithProjection({
      event: {
        workspaceId,
        aggregateType: this.projectionType,
        aggregateId: stored.id,
        eventType: `${this.projectionType}.snapshot`,
        eventVersion: 1,
        idempotencyKey: `${this.projectionType}:snapshot:${stored.id}:${version}`,
        payload: { record: stored, reason },
        metadata: { projectionType: this.projectionType },
      },
      projection: {
        projectionType: this.projectionType,
        projectionId: stored.id,
        workspaceId,
        version,
        data: stored,
      },
    });
    this.records.set(stored.id, stored);
    return stored;
  }
}

class CanonicalEventWriter {
  constructor({ store, workspaceResolver = () => 'system' }) {
    this.store = store;
    this.workspaceResolver = workspaceResolver;
  }

  append(event) {
    if (!event?.type || !event?.idempotencyKey) throw new TypeError('canonical event type and idempotencyKey are required');
    const { type, idempotencyKey, ...payload } = event;
    const workspaceId = event.workspaceId || this.workspaceResolver(event) || 'system';
    return this.store.appendEvent({
      workspaceId,
      aggregateType: event.runId ? 'executionRun' : event.gateId ? 'humanGate' : 'application',
      aggregateId: event.runId || event.gateId || 's1-application',
      eventType: type,
      eventVersion: 1,
      idempotencyKey,
      payload,
      metadata: { source: 's1-application' },
    }).event;
  }
}

module.exports = { CanonicalEventWriter, ProjectionRepository };
