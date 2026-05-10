CREATE TABLE IF NOT EXISTS hosted_usage_history (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  connectionId TEXT,
  apiKey TEXT,
  endpoint TEXT,
  promptTokens INTEGER DEFAULT 0,
  completionTokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  status TEXT,
  tokens TEXT,
  meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_hosted_usage_timestamp ON hosted_usage_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_hosted_usage_provider ON hosted_usage_history(provider);

CREATE TABLE IF NOT EXISTS hosted_request_details (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  connectionId TEXT,
  status TEXT,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hosted_request_details_timestamp ON hosted_request_details(timestamp);
