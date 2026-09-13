-- radarnews schema v1
-- documents are per run_day; same content_hash may repeat across days.

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  interactions INTEGER NOT NULL DEFAULT 0,
  run_id TEXT NOT NULL,
  run_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  UNIQUE (run_day, content_hash)
);

CREATE INDEX documents_run_day_hash ON documents (run_day, content_hash);
CREATE INDEX documents_run_id ON documents (run_id);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  canonical_name TEXT NOT NULL UNIQUE,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  src_id TEXT NOT NULL,
  src_type TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  dst_type TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  run_day TEXT NOT NULL
);

CREATE INDEX edges_run_day ON edges (run_day);

CREATE TABLE communities (
  id TEXT PRIMARY KEY,
  run_day TEXT NOT NULL,
  run_id TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'leiden',
  resolution REAL,
  size INTEGER NOT NULL DEFAULT 0,
  label_vi TEXT,
  heat REAL,
  rank INTEGER,
  stable_key TEXT
);

CREATE INDEX communities_run_day_stable ON communities (run_day, stable_key);

CREATE TABLE node_communities (
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  community_id TEXT NOT NULL,
  run_day TEXT NOT NULL,
  PRIMARY KEY (node_id, node_type, run_day)
);

CREATE TABLE scores (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  run_day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  weight REAL,
  composite REAL
);

CREATE TABLE extracts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  model TEXT NOT NULL,
  question TEXT,
  insight TEXT,
  evidence_json TEXT,
  counter TEXT,
  token_cost INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_day TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  wall_ms INTEGER,
  gemini_rpd_used INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX jobs_run_id ON jobs (run_id);
CREATE INDEX jobs_kind_day_status ON jobs (kind, run_day, status);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_ok_at TEXT,
  last_error TEXT
);

CREATE TABLE source_runs (
  run_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, source_id)
);

CREATE INDEX source_runs_run_status ON source_runs (run_id, status);
