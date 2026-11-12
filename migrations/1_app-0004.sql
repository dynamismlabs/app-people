CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, value TEXT NOT NULL);


CREATE TABLE app_jobs (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  kind TEXT NOT NULL, source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','running','paused','failed')),
  attempts INTEGER NOT NULL, next_eligible_at TEXT NOT NULL,
  last_run_at TEXT, last_success_at TEXT, last_error TEXT, idempotent INTEGER NOT NULL,
  UNIQUE (kind, source_key));


CREATE INDEX app_jobs_due ON app_jobs (state, next_eligible_at);


CREATE TABLE app_source_accounts (
  account TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('mail','calendar')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, label TEXT, history_days INTEGER NOT NULL,
  checkpoint TEXT, calendars TEXT NOT NULL, paused INTEGER NOT NULL, status TEXT NOT NULL,
  last_error TEXT, last_success_at TEXT, PRIMARY KEY (account, kind));


CREATE TABLE app_mail_messages (
  account TEXT NOT NULL, message_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  thread_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('kept','skipped','removed')),
  received_at TEXT, digest TEXT, PRIMARY KEY (account, message_id));


CREATE INDEX app_mail_messages_thread ON app_mail_messages (account, thread_id);


CREATE TABLE app_invocations (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, input_digest TEXT NOT NULL, result TEXT NOT NULL, authority TEXT);


CREATE TABLE evidence_blobs (digest TEXT PRIMARY KEY, created_at TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL);
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('app-0004','4b75ba31fb9301a59a398e88c5ecd0fd0f654c7f1f4e1738d1f31d2d79e6c3b3',CURRENT_TIMESTAMP);
