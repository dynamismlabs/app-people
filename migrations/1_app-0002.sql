CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
ALTER TABLE briefings ADD COLUMN scope_sources TEXT;
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('app-0002','8fe82d2431ae5c624b2ffb97d174ac2325ffbe9636dfa5b584d210c980561a46',CURRENT_TIMESTAMP);
