CREATE TABLE IF NOT EXISTS execution_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version >= 1),
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX IF NOT EXISTS execution_events_workspace_sequence
  ON execution_events(workspace_id, sequence);
CREATE INDEX IF NOT EXISTS execution_events_aggregate_sequence
  ON execution_events(aggregate_type, aggregate_id, sequence);

CREATE TABLE IF NOT EXISTS projection_records (
  projection_type TEXT NOT NULL,
  projection_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  data_json TEXT NOT NULL,
  updated_event_sequence INTEGER,
  PRIMARY KEY (projection_type, projection_id),
  FOREIGN KEY (updated_event_sequence) REFERENCES execution_events(sequence)
) STRICT;

CREATE INDEX IF NOT EXISTS projection_records_workspace
  ON projection_records(workspace_id, projection_type, projection_id);

CREATE TABLE IF NOT EXISTS s0_import_journal (
  source_sha256 TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  imported_event_count INTEGER NOT NULL CHECK (imported_event_count >= 0),
  imported_at TEXT NOT NULL
) STRICT;
