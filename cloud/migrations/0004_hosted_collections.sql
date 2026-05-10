CREATE TABLE IF NOT EXISTS hosted_combos (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_proxy_pools (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hosted_combos_updatedAt ON hosted_combos(updatedAt);
CREATE INDEX IF NOT EXISTS idx_hosted_proxy_pools_updatedAt ON hosted_proxy_pools(updatedAt);
