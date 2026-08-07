'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const base = require('./sqlite-event-store.cjs');
const { assertNoForbiddenSecrets, stableStringify } = base;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}

function normalizeImportedEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('mapped import event must be an object');
  const payload = input.payload === undefined ? {} : input.payload;
  const metadata = input.metadata === undefined ? {} : input.metadata;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('mapped event payload must be an object');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('mapped event metadata must be an object');
  assertNoForbiddenSecrets(payload, 'mapped event payload');
  assertNoForbiddenSecrets(metadata, 'mapped event metadata');
  const eventVersion = Number(input.eventVersion ?? 1);
  if (!Number.isInteger(eventVersion) || eventVersion < 1) throw new RangeError('mapped event version must be positive');
  return Object.freeze({
    id: requiredString(input.id, 'mapped event id'),
    workspaceId: requiredString(input.workspaceId, 'mapped event workspaceId'),
    aggregateType: requiredString(input.aggregateType, 'mapped event aggregateType'),
    aggregateId: requiredString(input.aggregateId, 'mapped event aggregateId'),
    eventType: requiredString(input.eventType, 'mapped event eventType'),
    eventVersion,
    idempotencyKey: requiredString(input.idempotencyKey, 'mapped event idempotencyKey'),
    occurredAt: requiredString(input.occurredAt, 'mapped event occurredAt'),
    payload,
    metadata,
  });
}

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
        if (!sameProjection) throw new Error(`Idempotency projection collision: ${idempotencyKey}`);
      }
    }
    return super.appendWithProjection({ event, projection });
  }

  importS0Jsonl({ filePath, mapEvent = null, workspaceId = 'legacy-s0' }) {
    const absolute = resolve(filePath);
    const raw = readFileSync(absolute, 'utf8');
    const sourceSha256 = sha256(raw);
    const existing = this.database.prepare('SELECT * FROM s0_import_journal WHERE source_sha256 = ?').get(sourceSha256);
    if (existing) return Object.freeze({ sourceSha256, alreadyImported: true, importedEventCount: 0 });

    const parsed = raw.split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
    });

    const events = parsed.map((legacy, index) => {
      const line = index + 1;
      const mapped = mapEvent ? mapEvent(legacy, index, sourceSha256) : {
        id: legacy.id || `s0-${sourceSha256.slice(0, 24)}-${line}`,
        workspaceId: legacy.workspaceId || workspaceId,
        aggregateType: legacy.aggregateType || String(legacy.type || 'legacy.event').split('.')[0],
        aggregateId: legacy.aggregateId || legacy.task?.id || legacy.workerId || legacy.id || `legacy-${line}`,
        eventType: legacy.eventType || legacy.type || 'legacy.event',
        eventVersion: 1,
        idempotencyKey: `s0:${sourceSha256}:${line}`,
        occurredAt: legacy.occurredAt || new Date(0).toISOString(),
        payload: { legacyEvent: legacy },
        metadata: { source: 's0-jsonl', sourceSha256, sourceLine: line },
      };
      return normalizeImportedEvent(mapped);
    });

    const importedEventCount = this.withTransaction(() => {
      const insert = this.database.prepare(`
        INSERT INTO execution_events(
          id, workspace_id, aggregate_type, aggregate_id, event_type, event_version,
          idempotency_key, occurred_at, payload_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        insert.run(
          event.id, event.workspaceId, event.aggregateType, event.aggregateId, event.eventType,
          event.eventVersion, event.idempotencyKey, event.occurredAt,
          stableStringify(event.payload), stableStringify(event.metadata),
        );
      }
      this.database.prepare(`
        INSERT INTO s0_import_journal(source_sha256, source_path, imported_event_count, imported_at)
        VALUES (?, ?, ?, ?)
      `).run(sourceSha256, absolute, events.length, new Date().toISOString());
      return events.length;
    });
    return Object.freeze({ sourceSha256, alreadyImported: false, importedEventCount });
  }
}

module.exports = { ...base, S1SqliteEventStore };
