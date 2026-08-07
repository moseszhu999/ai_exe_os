'use strict';

const base = require('./sqlite-event-store.cjs');
const { stableStringify } = base;

class S1SqliteEventStore extends base.S1SqliteEventStore {
  appendWithProjection({ event, projection }) {
    const idempotencyKey = event?.idempotencyKey;
    if (idempotencyKey && projection) {
      const existingEvent = this.getEventByIdempotencyKey(idempotencyKey);
      if (existingEvent) {
        const existingProjection = this.getProjection(projection.projectionType, projection.projectionId);
        const sameProjection = existingProjection
          && existingProjection.workspaceId === projection.workspaceId
          && existingProjection.version === Number(projection.version)
          && stableStringify(existingProjection.data) === stableStringify(projection.data);
        if (!sameProjection) {
          throw new Error(`Idempotency projection collision: ${idempotencyKey}`);
        }
      }
    }
    return super.appendWithProjection({ event, projection });
  }
}

module.exports = {
  ...base,
  S1SqliteEventStore,
};
