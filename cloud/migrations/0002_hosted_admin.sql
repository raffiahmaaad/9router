CREATE TABLE IF NOT EXISTS hosted_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_auth (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_api_keys (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_provider_nodes (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_providers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hosted_api_keys_updatedAt ON hosted_api_keys(updatedAt);
CREATE INDEX IF NOT EXISTS idx_hosted_provider_nodes_updatedAt ON hosted_provider_nodes(updatedAt);
CREATE INDEX IF NOT EXISTS idx_hosted_providers_updatedAt ON hosted_providers(updatedAt);
