const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const FORBIDDEN_KEY = /^(password|passwd|cookie|cookies|set-cookie|authorization|authorizationcode|access[_-]?token|refresh[_-]?token|id[_-]?token|token|profilepath|browserprofile|userdata(dir)?|storagestate)$/i;
const FORBIDDEN_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertNoForbiddenSecrets(value, path = 'value', seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (FORBIDDEN_STRING.test(value)) throw new Error(`Forbidden secret-like value at ${path}`);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) throw new TypeError(`Circular value at ${path}`);
  seen.add(value);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new TypeError(`Binary values are not allowed at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSecrets(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`Forbidden secret field at ${path}.${key}`);
      assertNoForbiddenSecrets(nested, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}

function normalizeEvent(input) {
  const event = assertPlainObject(input, 'event');
  const payload = event.payload === undefined ? {} : event.payload;
  const metadata = event.metadata === undefined ? {} : event.metadata;
  assertPlainObject(payload, 'event.payload');
  assertPlainObject(metadata, 'event.metadata');
  assertNoForbiddenSecrets(payload, 'event.payload');
  assertNoForbiddenSecrets(metadata, 'event.metadata');
  const version = Number(event.eventVersion ?? 1);
  if (!Number.isInteger(version) || version < 1) throw new RangeError('event.eventVersion must be a positive integer');
  return Object.freeze({
    id: requiredString(event.id || randomUUID(), 'event.id'),
    workspaceId: requiredString(event.workspaceId, 'event.workspaceId'),
    aggregateType: requiredString(event.aggregateType, 'event.aggregateType'),
    aggregateId: requiredString(event.aggregateId, 'event.aggregateId'),
    eventType: requiredString(event.eventType, 'event.eventType'),
    eventVersion: version,
    idempotencyKey: requiredString(event.idempotencyKey, 'event.idempotencyKey'),
    occurredAt: requiredString(event.occurredAt || new Date().toISOString(), 'event.occurredAt'),
    payload,
    metadata,
  });
}

function normalizeProjection(input) {
  if (input === null || input === undefined) return null;
  const projection = assertPlainObject(input, 'projection');
  const version = Number(projection.version);
  if (!Number.isInteger(version) || version < 0) throw new RangeError('projection.version must be a non-negative integer');
  const data = assertPlainObject(projection.data, 'projection.data');
  assertNoForbiddenSecrets(data, 'projection.data');
  return Object.freeze({
    projectionType: requiredString(projection.projectionType, 'projection.projectionType'),
    projectionId: requiredString(projection.projectionId, 'projection.projectionId'),
    workspaceId: requiredString(projection.workspaceId, 'projection.workspaceId'),
    version,
    data,
  });
}

function decodeEvent(row) {
  if (!row) return null;
  return Object.freeze({
    sequence: Number(row.sequence),
    id: row.id,
    workspaceId: row.workspace_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    eventVersion: Number(row.event_version),
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload_json),
    metadata: JSON.parse(row.metadata_json),
  });
}

function decodeProjection(row) {
  if (!row) return null;
  return Object.freeze({
    projectionType: row.projection_type,
    projectionId: row.projection_id,
    workspaceId: row.workspace_id,
    version: Number(row.version),
    data: JSON.parse(row.data_json),
    updatedEventSequence: row.updated_event_sequence === null ? null : Number(row.updated_event_sequence),
  });
}

class S1SqliteEventStore {
  constructor({ databasePath = ':memory:', migrationsDirectory = null } = {}) {
    this.databasePath = databasePath === ':memory:' ? databasePath : resolve(databasePath);
    if (this.databasePath !== ':memory:') mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.databasePath, { timeout: 5000 });
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA synchronous = NORMAL;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    if (migrationsDirectory) this.migrate(migrationsDirectory);
    if (this.databasePath !== ':memory:' && existsSync(this.databasePath)) chmodSync(this.databasePath, 0o600);
  }

  migrate(migrationsDirectory) {
    const directory = resolve(migrationsDirectory);
    const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
    for (const fileName of files) {
      const sql = readFileSync(join(directory, fileName), 'utf8');
      const digest = sha256(sql);
      const existing = this.database.prepare('SELECT sha256 FROM schema_migrations WHERE version = ?').get(fileName);
      if (existing) {
        if (existing.sha256 !== digest) throw new Error(`Migration checksum mismatch: ${fileName}`);
        continue;
      }
      this.withTransaction(() => {
        this.database.exec(sql);
        this.database.prepare('INSERT INTO schema_migrations(version, sha256, applied_at) VALUES (?, ?, ?)')
          .run(fileName, digest, new Date().toISOString());
      });
    }
    return files.length;
  }

  withTransaction(callback) {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const result = callback();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  appendEvent(event) {
    return this.appendWithProjection({ event, projection: null });
  }

  appendWithProjection({ event: rawEvent, projection: rawProjection }) {
    const event = normalizeEvent(rawEvent);
    const projection = normalizeProjection(rawProjection);
    if (projection && projection.workspaceId !== event.workspaceId) {
      throw new Error('Projection workspace must match event workspace');
    }
    return this.withTransaction(() => {
      const existingRow = this.database.prepare('SELECT * FROM execution_events WHERE idempotency_key = ?')
        .get(event.idempotencyKey);
      if (existingRow) {
        const existing = decodeEvent(existingRow);
        const same = existing.workspaceId === event.workspaceId
          && existing.aggregateType === event.aggregateType
          && existing.aggregateId === event.aggregateId
          && existing.eventType === event.eventType
          && existing.eventVersion === event.eventVersion
          && stableStringify(existing.payload) === stableStringify(event.payload)
          && stableStringify(existing.metadata) === stableStringify(event.metadata);
        if (!same) throw new Error(`Idempotency key collision: ${event.idempotencyKey}`);
        return Object.freeze({ created: false, event: existing, projection: projection ? this.getProjection(projection.projectionType, projection.projectionId) : null });
      }

      const insert = this.database.prepare(`
        INSERT INTO execution_events(
          id, workspace_id, aggregate_type, aggregate_id, event_type, event_version,
          idempotency_key, occurred_at, payload_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.workspaceId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.eventVersion,
        event.idempotencyKey,
        event.occurredAt,
        stableStringify(event.payload),
        stableStringify(event.metadata),
      );
      const sequence = Number(insert.lastInsertRowid);
      let storedProjection = null;
      if (projection) storedProjection = this.#writeProjection(projection, sequence);
      return Object.freeze({ created: true, event: Object.freeze({ sequence, ...event }), projection: storedProjection });
    });
  }

  #writeProjection(projection, sequence) {
    const current = this.database.prepare(`
      SELECT * FROM projection_records WHERE projection_type = ? AND projection_id = ?
    `).get(projection.projectionType, projection.projectionId);
    if (current) {
      const decoded = decodeProjection(current);
      if (decoded.workspaceId !== projection.workspaceId) throw new Error('Projection workspace is immutable');
      if (projection.version < decoded.version) throw new Error('Projection version cannot move backwards');
      if (projection.version === decoded.version && stableStringify(decoded.data) !== stableStringify(projection.data)) {
        throw new Error('Projection version collision');
      }
    }
    this.database.prepare(`
      INSERT INTO projection_records(
        projection_type, projection_id, workspace_id, version, data_json, updated_event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(projection_type, projection_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        version = excluded.version,
        data_json = excluded.data_json,
        updated_event_sequence = excluded.updated_event_sequence
    `).run(
      projection.projectionType,
      projection.projectionId,
      projection.workspaceId,
      projection.version,
      stableStringify(projection.data),
      sequence,
    );
    return this.getProjection(projection.projectionType, projection.projectionId);
  }

  getEventByIdempotencyKey(idempotencyKey) {
    return decodeEvent(this.database.prepare('SELECT * FROM execution_events WHERE idempotency_key = ?').get(idempotencyKey));
  }

  listEvents({ workspaceId = null, aggregateType = null, aggregateId = null } = {}) {
    const clauses = [];
    const parameters = [];
    if (workspaceId) { clauses.push('workspace_id = ?'); parameters.push(workspaceId); }
    if (aggregateType) { clauses.push('aggregate_type = ?'); parameters.push(aggregateType); }
    if (aggregateId) { clauses.push('aggregate_id = ?'); parameters.push(aggregateId); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.database.prepare(`SELECT * FROM execution_events${where} ORDER BY sequence`).all(...parameters).map(decodeEvent);
  }

  getProjection(projectionType, projectionId) {
    return decodeProjection(this.database.prepare(`
      SELECT * FROM projection_records WHERE projection_type = ? AND projection_id = ?
    `).get(projectionType, projectionId));
  }

  listProjections({ projectionType = null, workspaceId = null } = {}) {
    const clauses = [];
    const parameters = [];
    if (projectionType) { clauses.push('projection_type = ?'); parameters.push(projectionType); }
    if (workspaceId) { clauses.push('workspace_id = ?'); parameters.push(workspaceId); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.database.prepare(`SELECT * FROM projection_records${where} ORDER BY projection_type, projection_id`)
      .all(...parameters).map(decodeProjection);
  }

  rebuildProjection({ projectionType, reducer, workspaceId = null }) {
    requiredString(projectionType, 'projectionType');
    if (typeof reducer !== 'function') throw new TypeError('reducer must be a function');
    const state = new Map();
    for (const event of this.listEvents({ workspaceId })) reducer(state, event);
    const records = [...state.values()].map(normalizeProjection);
    for (const record of records) {
      if (record.projectionType !== projectionType) throw new Error('Reducer returned an unexpected projection type');
      if (workspaceId && record.workspaceId !== workspaceId) throw new Error('Reducer returned an unexpected workspace');
    }
    this.withTransaction(() => {
      if (workspaceId) {
        this.database.prepare('DELETE FROM projection_records WHERE projection_type = ? AND workspace_id = ?')
          .run(projectionType, workspaceId);
      } else {
        this.database.prepare('DELETE FROM projection_records WHERE projection_type = ?').run(projectionType);
      }
      const insert = this.database.prepare(`
        INSERT INTO projection_records(
          projection_type, projection_id, workspace_id, version, data_json, updated_event_sequence
        ) VALUES (?, ?, ?, ?, ?, NULL)
      `);
      for (const record of records) {
        insert.run(record.projectionType, record.projectionId, record.workspaceId, record.version, stableStringify(record.data));
      }
    });
    return Object.freeze({ count: records.length, digest: this.projectionDigest({ projectionType, workspaceId }) });
  }

  projectionDigest({ projectionType = null, workspaceId = null } = {}) {
    const rows = this.listProjections({ projectionType, workspaceId }).map((row) => ({
      projectionType: row.projectionType,
      projectionId: row.projectionId,
      workspaceId: row.workspaceId,
      version: row.version,
      data: row.data,
    }));
    return sha256(stableStringify(rows));
  }

  importS0Jsonl({ filePath, mapEvent = null, workspaceId = 'legacy-s0' }) {
    const absolute = resolve(filePath);
    const raw = readFileSync(absolute, 'utf8');
    const sourceSha256 = sha256(raw);
    const existing = this.database.prepare('SELECT * FROM s0_import_journal WHERE source_sha256 = ?').get(sourceSha256);
    if (existing) {
      return Object.freeze({ sourceSha256, alreadyImported: true, importedEventCount: 0 });
    }
    const parsed = raw.split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
    });
    const events = parsed.map((legacy, index) => {
      const mapped = mapEvent ? mapEvent(legacy, index, sourceSha256) : {
        id: legacy.id || randomUUID(),
        workspaceId: legacy.workspaceId || workspaceId,
        aggregateType: legacy.aggregateType || String(legacy.type || 'legacy.event').split('.')[0],
        aggregateId: legacy.aggregateId || legacy.task?.id || legacy.worker?.id || legacy.id || `legacy-${index + 1}`,
        eventType: legacy.eventType || legacy.type || 'legacy.event',
        eventVersion: 1,
        idempotencyKey: `s0:${sourceSha256}:${index + 1}`,
        occurredAt: legacy.occurredAt || new Date(0).toISOString(),
        payload: { legacyEvent: legacy },
        metadata: { source: 's0-jsonl', sourceSha256, sourceLine: index + 1 },
      };
      return normalizeEvent(mapped);
    });
    const importedEventCount = this.withTransaction(() => {
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO execution_events(
          id, workspace_id, aggregate_type, aggregate_id, event_type, event_version,
          idempotency_key, occurred_at, payload_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let count = 0;
      for (const event of events) {
        const result = insert.run(
          event.id, event.workspaceId, event.aggregateType, event.aggregateId, event.eventType,
          event.eventVersion, event.idempotencyKey, event.occurredAt,
          stableStringify(event.payload), stableStringify(event.metadata),
        );
        count += Number(result.changes);
      }
      this.database.prepare(`
        INSERT INTO s0_import_journal(source_sha256, source_path, imported_event_count, imported_at)
        VALUES (?, ?, ?, ?)
      `).run(sourceSha256, absolute, count, new Date().toISOString());
      return count;
    });
    return Object.freeze({ sourceSha256, alreadyImported: false, importedEventCount });
  }

  exportEventsJsonl(outputPath) {
    const absolute = resolve(outputPath);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    const text = this.listEvents().map((event) => JSON.stringify(event)).join('\n');
    writeFileSync(absolute, text ? `${text}\n` : '', { encoding: 'utf8', mode: 0o600 });
    return absolute;
  }

  health() {
    const foreignKeys = Number(this.database.prepare('PRAGMA foreign_keys').get().foreign_keys) === 1;
    const journalModeRow = this.database.prepare('PRAGMA journal_mode').get();
    const journalMode = String(journalModeRow.journal_mode || Object.values(journalModeRow)[0]).toLowerCase();
    return Object.freeze({ foreignKeys, journalMode, databasePath: this.databasePath });
  }

  close() {
    if (this.database.isOpen) this.database.close();
  }
}

module.exports = {
  S1SqliteEventStore,
  assertNoForbiddenSecrets,
  stableStringify,
};
