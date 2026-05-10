const PERIOD_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
};

let usageEnv = null;
let schemaReady = false;

export function setUsageEnv(env) {
  usageEnv = env;
}

function getEnv(env = usageEnv) {
  if (!env?.DB) throw new Error("Usage database is not configured");
  return env;
}

function jsonString(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getTokenCounts(tokens = {}) {
  return {
    promptTokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completionTokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0,
  };
}

function periodCutoff(period) {
  if (!period || period === "all") return null;
  const ms = PERIOD_MS[period] || PERIOD_MS["7d"];
  return new Date(Date.now() - ms).toISOString();
}

async function ensureSchema(env = usageEnv) {
  const current = getEnv(env);
  if (schemaReady) return current;

  await current.DB.exec(`
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
  `);

  schemaReady = true;
  return current;
}

function createEmptyStats() {
  return {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: {},
    byEndpoint: {},
    last10Minutes: Array.from({ length: 10 }, () => ({
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
    })),
    pending: { byModel: {}, byAccount: {} },
    activeRequests: [],
    recentRequests: [],
    errorProvider: "",
  };
}

function addCounter(target, key, values) {
  if (!key) return;
  if (!target[key]) {
    target[key] = {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      ...values.meta,
    };
  }
  target[key].requests += 1;
  target[key].promptTokens += values.promptTokens;
  target[key].completionTokens += values.completionTokens;
  target[key].cost += values.cost;
  if (values.lastUsed && (!target[key].lastUsed || values.lastUsed > target[key].lastUsed)) {
    target[key].lastUsed = values.lastUsed;
  }
}

function aggregateRow(stats, row, connectionMap = {}, apiKeyMap = {}) {
  const promptTokens = row.promptTokens || 0;
  const completionTokens = row.completionTokens || 0;
  const cost = row.cost || 0;
  const provider = row.provider || "unknown";
  const model = row.model || "unknown";
  const lastUsed = row.timestamp;

  stats.totalRequests += 1;
  stats.totalPromptTokens += promptTokens;
  stats.totalCompletionTokens += completionTokens;
  stats.totalCost += cost;

  const values = { promptTokens, completionTokens, cost, lastUsed };
  addCounter(stats.byProvider, provider, values);
  addCounter(stats.byModel, `${model} (${provider})`, {
    ...values,
    meta: { rawModel: model, provider, lastUsed },
  });

  if (row.connectionId) {
    const accountName = connectionMap[row.connectionId] || `Account ${row.connectionId.slice(0, 8)}...`;
    addCounter(stats.byAccount, `${model} (${provider} - ${accountName})`, {
      ...values,
      meta: { rawModel: model, provider, connectionId: row.connectionId, accountName, lastUsed },
    });
  }

  const apiKeyKey = row.apiKey ? `${row.apiKey}|${model}|${provider}` : "local-no-key";
  const keyName = row.apiKey ? apiKeyMap[row.apiKey] || `${row.apiKey.slice(0, 8)}...` : "Local (No API Key)";
  addCounter(stats.byApiKey, apiKeyKey, {
    ...values,
    meta: { rawModel: model, provider, apiKey: row.apiKey || null, keyName, apiKeyKey: row.apiKey || "local-no-key", lastUsed },
  });

  const endpoint = row.endpoint || "Unknown";
  addCounter(stats.byEndpoint, `${endpoint}|${model}|${provider}`, {
    ...values,
    meta: { rawModel: model, provider, endpoint, lastUsed },
  });
}

async function getConnectionMap(env) {
  const { results } = await env.DB.prepare("SELECT id, data FROM hosted_providers").all();
  const map = {};
  for (const row of results || []) {
    const connection = parseJson(row.data);
    map[row.id] = connection.name || connection.email || row.id;
  }
  return map;
}

async function getApiKeyMap(env) {
  const { results } = await env.DB.prepare("SELECT data FROM hosted_api_keys").all();
  const map = {};
  for (const row of results || []) {
    const apiKey = parseJson(row.data);
    if (apiKey.key) map[apiKey.key] = apiKey.name || apiKey.id;
  }
  return map;
}

function bindMaybe(statement, params) {
  return params.length ? statement.bind(...params) : statement;
}

export async function saveRequestUsage(entry = {}) {
  const env = await ensureSchema();
  const timestamp = entry.timestamp || new Date().toISOString();
  const tokens = entry.tokens || {};
  const { promptTokens, completionTokens } = getTokenCounts(tokens);

  await env.DB.prepare(`
    INSERT INTO hosted_usage_history
      (id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    timestamp,
    entry.provider || "unknown",
    entry.model || "unknown",
    entry.connectionId || null,
    entry.apiKey || null,
    entry.endpoint || null,
    promptTokens,
    completionTokens,
    entry.cost || 0,
    entry.status || "ok",
    jsonString(tokens),
    jsonString(entry.meta),
  ).run();
}

export async function saveRequestDetail(detail = {}) {
  const env = await ensureSchema();
  const timestamp = detail.timestamp || new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO hosted_request_details
      (id, timestamp, provider, model, connectionId, status, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    detail.id || crypto.randomUUID(),
    timestamp,
    detail.provider || "unknown",
    detail.model || "unknown",
    detail.connectionId || null,
    detail.status || "success",
    jsonString({ ...detail, timestamp }),
  ).run();
}

export function trackPendingRequest() {}

export async function appendRequestLog() {}

export async function getUsageStats(period = "7d", envOverride) {
  const env = await ensureSchema(envOverride);
  const cutoff = periodCutoff(period);
  const rows = cutoff
    ? (await env.DB.prepare("SELECT * FROM hosted_usage_history WHERE timestamp >= ? ORDER BY timestamp ASC").bind(cutoff).all()).results || []
    : (await env.DB.prepare("SELECT * FROM hosted_usage_history ORDER BY timestamp ASC").all()).results || [];

  const [connectionMap, apiKeyMap] = await Promise.all([getConnectionMap(env), getApiKeyMap(env)]);
  const stats = createEmptyStats();
  rows.forEach((row) => aggregateRow(stats, row, connectionMap, apiKeyMap));

  stats.recentRequests = [...rows]
    .reverse()
    .slice(0, 20)
    .map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      provider: row.provider || "",
      promptTokens: row.promptTokens || 0,
      completionTokens: row.completionTokens || 0,
      status: row.status || "ok",
    }));

  return stats;
}

export async function getChartData(period = "7d", envOverride) {
  const env = await ensureSchema(envOverride);
  const bucketCount = period === "24h" ? 24 : period === "30d" ? 30 : period === "60d" ? 60 : 7;
  const bucketMs = period === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const start = Date.now() - (bucketCount - 1) * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const ts = start + index * bucketMs;
    const date = new Date(ts);
    return {
      label: period === "24h"
        ? date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      tokens: 0,
      cost: 0,
    };
  });

  const { results } = await env.DB.prepare("SELECT timestamp, promptTokens, completionTokens, cost FROM hosted_usage_history WHERE timestamp >= ?")
    .bind(new Date(start).toISOString())
    .all();

  for (const row of results || []) {
    const index = Math.min(Math.max(Math.floor((new Date(row.timestamp).getTime() - start) / bucketMs), 0), bucketCount - 1);
    buckets[index].tokens += (row.promptTokens || 0) + (row.completionTokens || 0);
    buckets[index].cost += row.cost || 0;
  }

  return buckets;
}

export async function getRequestDetails(filter = {}, envOverride) {
  const env = await ensureSchema(envOverride);
  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize) || 20));
  const where = [];
  const params = [];

  for (const key of ["provider", "model", "connectionId", "status"]) {
    if (filter[key]) {
      where.push(`${key} = ?`);
      params.push(filter[key]);
    }
  }
  if (filter.startDate) {
    where.push("timestamp >= ?");
    params.push(new Date(filter.startDate).toISOString());
  }
  if (filter.endDate) {
    where.push("timestamp <= ?");
    params.push(new Date(filter.endDate).toISOString());
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await bindMaybe(
    env.DB.prepare(`SELECT COUNT(*) AS total FROM hosted_request_details ${whereSql}`),
    params,
  ).first();
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const { results } = await env.DB.prepare(`
    SELECT data FROM hosted_request_details ${whereSql}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).bind(...listParams).all();

  const details = (results || []).map((row) => parseJson(row.data));
  const total = totalRow?.total || 0;

  return {
    details,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getUsageProviders(envOverride) {
  const env = await ensureSchema(envOverride);
  const { results } = await env.DB.prepare("SELECT DISTINCT provider FROM hosted_request_details WHERE provider IS NOT NULL ORDER BY provider ASC").all();
  return { providers: (results || []).map((row) => ({ id: row.provider, name: row.provider })) };
}

export async function getRecentLogs(limit = 200, envOverride) {
  const env = await ensureSchema(envOverride);
  const { results } = await env.DB.prepare(`
    SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status
    FROM hosted_usage_history
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(limit).all();

  return (results || []).map((row) => {
    const date = new Date(row.timestamp).toISOString().replace("T", " ").slice(0, 19);
    return `${date} | ${row.model || "-"} | ${(row.provider || "-").toUpperCase()} | ${row.connectionId || "-"} | ${row.promptTokens ?? "-"} | ${row.completionTokens ?? "-"} | ${row.status || "-"}`;
  });
}

export async function getUsageDb(envOverride) {
  const env = await ensureSchema(envOverride);
  const { results } = await env.DB.prepare("SELECT * FROM hosted_usage_history ORDER BY timestamp ASC").all();
  return { data: { history: results || [] } };
}

export async function getUsageHistory(filter = {}, envOverride) {
  const env = await ensureSchema(envOverride);
  const cutoff = filter.startDate ? new Date(filter.startDate).toISOString() : null;
  const rows = cutoff
    ? (await env.DB.prepare("SELECT * FROM hosted_usage_history WHERE timestamp >= ? ORDER BY timestamp ASC").bind(cutoff).all()).results || []
    : (await env.DB.prepare("SELECT * FROM hosted_usage_history ORDER BY timestamp ASC").all()).results || [];

  return rows.map((row) => ({
    ...row,
    tokens: parseJson(row.tokens),
  }));
}
