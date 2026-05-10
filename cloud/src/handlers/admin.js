const SESSION_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_SETTINGS = {
  requireLogin: true,
  tunnelDashboardAccess: true,
  tunnelUrl: "",
  tailscaleUrl: "",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorized(message = "Unauthorized", code = "MISCONFIGURED_HOSTED_MODE", status = 401) {
  return json({ error: message, code }, status);
}

function getUpdatedAt() {
  return new Date().toISOString();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, env) {
  return sha256(`${env.ADMIN_SECRET}:${password}`);
}

async function verifyAdminRequest(request, env) {
  const secret = env.ADMIN_SECRET;
  const header = request.headers.get("authorization") || "";
  if (!secret) return unauthorized("Missing ADMIN_SECRET", "MISSING_HOSTED_CONFIG", 500);
  if (header !== `Bearer ${secret}`) return unauthorized();
  return null;
}

async function readRecord(env, table, key) {
  return env.DB.prepare(`SELECT value FROM ${table} WHERE key = ?`).bind(key).first();
}

async function writeRecord(env, table, key, value) {
  const updatedAt = getUpdatedAt();
  await env.DB.prepare(
    `INSERT INTO ${table} (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updatedAt = ?`
  ).bind(key, value, updatedAt, value, updatedAt).run();
}

async function listJsonRows(env, table) {
  const { results } = await env.DB.prepare(`SELECT data FROM ${table} ORDER BY updatedAt DESC`).all();
  return (results || []).map((row) => JSON.parse(row.data));
}

async function getJsonRow(env, table, id) {
  const row = await env.DB.prepare(`SELECT data FROM ${table} WHERE id = ?`).bind(id).first();
  return row ? JSON.parse(row.data) : null;
}

async function upsertJsonRow(env, table, id, data) {
  const updatedAt = getUpdatedAt();
  const next = { ...data, id, updatedAt };
  await env.DB.prepare(
    `INSERT INTO ${table} (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?`
  ).bind(id, JSON.stringify(next), updatedAt, JSON.stringify(next), updatedAt).run();
  return next;
}

async function deleteJsonRow(env, table, id) {
  const result = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return result.meta?.changes > 0;
}

function stripProviderSecrets(connection) {
  const result = { ...connection };
  delete result.apiKey;
  delete result.accessToken;
  delete result.refreshToken;
  delete result.idToken;
  return result;
}

function generateId(prefix = "") {
  return `${prefix}${crypto.randomUUID()}`;
}

async function createApiKey(name) {
  const machineId = "hosted";
  const keyId = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const crc = await sha256(`${machineId}${keyId}`);
  const id = generateId("key_");
  const token = `sk-${machineId}-${keyId}-${crc.slice(0, 8)}`;
  return {
    id,
    name,
    key: token,
    machineId,
    isActive: true,
    createdAt: getUpdatedAt(),
  };
}

function getActiveModelLocks(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith("modelLock_") && value)
    .map(([key, value]) => ({
      key,
      model: key.slice("modelLock_".length) || "__all",
      until: value,
      active: new Date(value).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

async function getHostedSettings(env) {
  const row = await readRecord(env, "hosted_settings", "dashboard");
  if (!row) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
}

async function getHostedModelAliases(env) {
  const row = await readRecord(env, "hosted_settings", "modelAliases");
  if (!row) return {};
  return JSON.parse(row.value);
}

async function saveHostedModelAliases(env, aliases) {
  await writeRecord(env, "hosted_settings", "modelAliases", JSON.stringify(aliases || {}));
  return aliases || {};
}

async function saveHostedSettings(env, patch) {
  const current = await getHostedSettings(env);
  const next = { ...current, ...patch };
  await writeRecord(env, "hosted_settings", "dashboard", JSON.stringify(next));
  return next;
}

async function getHostedAuth(env) {
  const row = await readRecord(env, "hosted_auth", "dashboard");
  if (!row) return null;
  return JSON.parse(row.value);
}

async function verifyPassword(password, env) {
  const auth = await getHostedAuth(env);
  if (!auth?.passwordHash) {
    const initialPassword = env.INITIAL_PASSWORD || "123456";
    return password === initialPassword;
  }
  const hash = await hashPassword(password, env);
  return hash === auth.passwordHash;
}

async function createSession(env) {
  const sessionId = crypto.randomUUID();
  await env.KV.put(`hosted_session:${sessionId}`, JSON.stringify({ authenticated: true }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return sessionId;
}

async function readSession(request, env) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) return null;
  const session = await env.KV.get(`hosted_session:${sessionId}`, "json");
  return session ? { sessionId, session } : null;
}

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const authError = await verifyAdminRequest(request, env);
  if (authError) return authError;

  if (url.pathname === "/admin/auth/login" && request.method === "POST") {
    const { password } = await request.json();
    const valid = await verifyPassword(password, env);
    if (!valid) return json({ error: "Invalid password", code: "INVALID_CREDENTIALS" }, 401);
    const sessionId = await createSession(env);
    return json({ success: true, sessionId });
  }

  if (url.pathname === "/admin/auth/session" && request.method === "GET") {
    const session = await readSession(request, env);
    if (!session) return json({ authenticated: false, code: "INVALID_CREDENTIALS" }, 401);
    return json({ authenticated: true, sessionId: session.sessionId });
  }

  if (url.pathname === "/admin/auth/logout" && request.method === "POST") {
    const sessionId = request.headers.get("x-session-id");
    if (sessionId) await env.KV.delete(`hosted_session:${sessionId}`);
    return json({ success: true });
  }

  if (url.pathname === "/admin/settings" && request.method === "GET") {
    const settings = await getHostedSettings(env);
    const auth = await getHostedAuth(env);
    return json({ ...settings, hasPassword: !!auth?.passwordHash });
  }

  if (url.pathname === "/admin/settings" && request.method === "PATCH") {
    const body = await request.json();
    if (body.newPassword) {
      const currentValid = await verifyPassword(body.currentPassword || "", env);
      const hasExistingPassword = !!(await getHostedAuth(env))?.passwordHash;
      if (hasExistingPassword && !currentValid) {
        return json({ error: "Invalid current password", code: "INVALID_CREDENTIALS" }, 401);
      }
      const passwordHash = await hashPassword(body.newPassword, env);
      await writeRecord(env, "hosted_auth", "dashboard", JSON.stringify({ passwordHash }));
      delete body.newPassword;
      delete body.currentPassword;
    }
    const settings = await saveHostedSettings(env, body);
    return json({ ...settings, hasPassword: !!(await getHostedAuth(env))?.passwordHash });
  }

  if (url.pathname === "/admin/models/alias" && request.method === "GET") {
    return json({ aliases: await getHostedModelAliases(env) });
  }

  if (url.pathname === "/admin/models/alias" && request.method === "PUT") {
    const { model, alias } = await request.json();
    if (!model || !alias) return json({ error: "Model and alias required" }, 400);

    const aliases = await getHostedModelAliases(env);
    const existingModel = aliases[alias];
    if (existingModel && existingModel !== model) {
      return json({ error: `Alias '${alias}' already in use for model '${existingModel}'` }, 400);
    }

    aliases[alias] = model;
    await saveHostedModelAliases(env, aliases);
    return json({ success: true, model, alias });
  }

  if (url.pathname === "/admin/models/alias" && request.method === "DELETE") {
    const alias = url.searchParams.get("alias");
    if (!alias) return json({ error: "Alias required" }, 400);

    const aliases = await getHostedModelAliases(env);
    delete aliases[alias];
    await saveHostedModelAliases(env, aliases);
    return json({ success: true });
  }

  if (url.pathname === "/admin/api-keys" && request.method === "GET") {
    return json({ keys: await listJsonRows(env, "hosted_api_keys") });
  }

  if (url.pathname === "/admin/api-keys" && request.method === "POST") {
    const { name } = await request.json();
    if (!name?.trim()) return json({ error: "Name is required" }, 400);
    const apiKey = await createApiKey(name.trim());
    await upsertJsonRow(env, "hosted_api_keys", apiKey.id, apiKey);
    return json(apiKey, 201);
  }

  if (url.pathname.match(/^\/admin\/api-keys\/[^/]+$/)) {
    const id = url.pathname.split("/").pop();
    if (request.method === "GET") {
      const key = await getJsonRow(env, "hosted_api_keys", id);
      if (!key) return json({ error: "Key not found" }, 404);
      return json({ key });
    }
    if (request.method === "PUT") {
      const existing = await getJsonRow(env, "hosted_api_keys", id);
      if (!existing) return json({ error: "Key not found" }, 404);
      const body = await request.json();
      const updated = await upsertJsonRow(env, "hosted_api_keys", id, { ...existing, isActive: body.isActive ?? existing.isActive });
      return json({ key: updated });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteJsonRow(env, "hosted_api_keys", id);
      if (!deleted) return json({ error: "Key not found" }, 404);
      return json({ message: "Key deleted successfully" });
    }
  }

  if (url.pathname === "/admin/provider-nodes" && request.method === "GET") {
    return json({ nodes: await listJsonRows(env, "hosted_provider_nodes") });
  }

  if (url.pathname === "/admin/provider-nodes" && request.method === "POST") {
    const body = await request.json();
    const node = await upsertJsonRow(env, "hosted_provider_nodes", body.id || generateId("node_"), body);
    return json({ node }, 201);
  }

  if (url.pathname.match(/^\/admin\/provider-nodes\/[^/]+$/)) {
    const id = url.pathname.split("/").pop();
    if (request.method === "PUT") {
      const existing = await getJsonRow(env, "hosted_provider_nodes", id);
      if (!existing) return json({ error: "Provider node not found" }, 404);
      const body = await request.json();
      const node = await upsertJsonRow(env, "hosted_provider_nodes", id, { ...existing, ...body });
      const providers = await listJsonRows(env, "hosted_providers");
      await Promise.all(providers.filter((provider) => provider.provider === id).map((provider) => upsertJsonRow(env, "hosted_providers", provider.id, {
        ...provider,
        providerSpecificData: {
          ...(provider.providerSpecificData || {}),
          prefix: node.prefix,
          apiType: node.apiType,
          baseUrl: node.baseUrl,
          nodeName: node.name,
        },
      })));
      return json({ node });
    }
    if (request.method === "DELETE") {
      await deleteJsonRow(env, "hosted_provider_nodes", id);
      const providers = await listJsonRows(env, "hosted_providers");
      await Promise.all(providers.filter((provider) => provider.provider === id).map((provider) => deleteJsonRow(env, "hosted_providers", provider.id)));
      return json({ success: true });
    }
  }

  if (url.pathname === "/admin/providers" && request.method === "GET") {
    const connections = await listJsonRows(env, "hosted_providers");
    return json({ connections: connections.map(stripProviderSecrets) });
  }

  if (url.pathname === "/admin/providers" && request.method === "POST") {
    const body = await request.json();
    const connection = await upsertJsonRow(env, "hosted_providers", body.id || generateId("provider_"), {
      ...body,
      isActive: body.isActive ?? true,
      testStatus: body.testStatus || "unknown",
    });
    return json({ connection: stripProviderSecrets(connection) }, 201);
  }

  if (url.pathname.match(/^\/admin\/providers\/[^/]+$/)) {
    const id = url.pathname.split("/").pop();
    if (request.method === "GET") {
      const connection = await getJsonRow(env, "hosted_providers", id);
      if (!connection) return json({ error: "Connection not found" }, 404);
      return json({ connection: stripProviderSecrets(connection) });
    }
    if (request.method === "PUT") {
      const existing = await getJsonRow(env, "hosted_providers", id);
      if (!existing) return json({ error: "Connection not found" }, 404);
      const body = await request.json();
      const connection = await upsertJsonRow(env, "hosted_providers", id, { ...existing, ...body });
      return json({ connection: stripProviderSecrets(connection) });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteJsonRow(env, "hosted_providers", id);
      if (!deleted) return json({ error: "Connection not found" }, 404);
      return json({ message: "Connection deleted successfully" });
    }
  }

  if (url.pathname === "/admin/models/availability" && request.method === "GET") {
    const connections = await listJsonRows(env, "hosted_providers");
    const models = [];
    for (const connection of connections) {
      const locks = getActiveModelLocks(connection);
      for (const lock of locks) {
        models.push({
          provider: connection.provider,
          model: lock.model,
          status: "cooldown",
          until: lock.until,
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }
      if (locks.length === 0 && connection.testStatus === "unavailable") {
        models.push({
          provider: connection.provider,
          model: "__all",
          status: "unavailable",
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }
    }
    return json({ models, unavailableCount: models.length });
  }

  if (url.pathname === "/admin/models/availability" && request.method === "POST") {
    const { action, provider, model } = await request.json();
    if (action !== "clearCooldown" || !provider || !model) return json({ error: "Invalid request" }, 400);
    const connections = await listJsonRows(env, "hosted_providers");
    const lockKey = `modelLock_${model}`;
    await Promise.all(connections.filter((connection) => connection.provider === provider && connection[lockKey]).map((connection) => upsertJsonRow(env, "hosted_providers", connection.id, {
      ...connection,
      [lockKey]: null,
      ...(connection.testStatus === "unavailable" ? {
        testStatus: "active",
        lastError: null,
        lastErrorAt: null,
        backoffLevel: 0,
      } : {}),
    })));
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}
