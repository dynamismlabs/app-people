CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
ALTER TABLE persons ADD COLUMN birthday_month INTEGER;


ALTER TABLE persons ADD COLUMN birthday_day INTEGER;


ALTER TABLE persons ADD COLUMN birthday_year INTEGER;


ALTER TABLE persons ADD COLUMN location TEXT;


ALTER TABLE persons ADD COLUMN how_met TEXT;


ALTER TABLE persons ADD COLUMN my_read TEXT;


CREATE INDEX persons_birthday ON persons (birthday_month, birthday_day) WHERE birthday_month IS NOT NULL;


ALTER TABLE notes ADD COLUMN origin TEXT;


ALTER TABLE notes ADD COLUMN origin_label TEXT;


CREATE TABLE person_relations (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  person_id TEXT NOT NULL, kind TEXT NOT NULL, related_person_id TEXT, related_name TEXT, note TEXT,
  collection TEXT NOT NULL, archived_at TEXT,
  CHECK ((related_person_id IS NULL) != (related_name IS NULL))
);


CREATE INDEX person_relations_person ON person_relations (person_id, archived_at);


CREATE INDEX person_relations_related ON person_relations (related_person_id, archived_at);


CREATE TABLE profiles (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, scope_sources TEXT,
  body TEXT NOT NULL, covered_through TEXT, evidence_count INTEGER NOT NULL,
  extraction_version TEXT NOT NULL, origin TEXT NOT NULL, generated_at TEXT NOT NULL
);


CREATE INDEX profiles_subject ON profiles (subject_kind, subject_id, generated_at);
INSERT INTO _migrations (id,checksum,applied_at) VALUES ('app-0003','d6aaf1d278249e2436fb2734b1bca712020cfa7e2a907e8a2a93fdeceb7b7fd4',CURRENT_TIMESTAMP);
