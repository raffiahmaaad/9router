import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";

async function getLocalDbModule() {
  return import("@/lib/localDb");
}

async function getProviderConnections(filter) {
  return (await getLocalDbModule()).getProviderConnections(filter);
}

async function updateProviderConnection(id, data) {
  return (await getLocalDbModule()).updateProviderConnection(id, data);
}

async function getHostedProviderConnections() {
  return (await callCloudAdmin("/admin/providers", { method: "GET" })).connections || [];
}

async function clearHostedModelCooldown(provider, model) {
  return callCloudAdmin("/admin/models/availability", {
    method: "POST",
    body: JSON.stringify({ action: "clearCooldown", provider, model }),
  });
}

async function getHostedAvailability() {
  return callCloudAdmin("/admin/models/availability", { method: "GET" });
}

const MODEL_LOCK_PREFIX = "modelLock_";

function getActiveModelLocks(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value,
      active: new Date(value).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

export async function GET() {
  try {
    if (isHostedMode()) {
      const data = await getHostedAvailability();
      return NextResponse.json(data);
    }

    const connections = await getProviderConnections();
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

    return NextResponse.json({
      models,
      unavailableCount: models.length,
    });
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json(
      { error: "Failed to fetch model availability" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const { action, provider, model } = await request.json();

    if (action !== "clearCooldown" || !provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (isHostedMode()) {
      await clearHostedModelCooldown(provider, model);
      return NextResponse.json({ ok: true });
    }

    const connections = await getProviderConnections({ provider });
    const lockKey = `${MODEL_LOCK_PREFIX}${model}`;

    await Promise.all(
      connections
        .filter((connection) => connection[lockKey])
        .map((connection) =>
          updateProviderConnection(connection.id, {
            [lockKey]: null,
            ...(connection.testStatus === "unavailable"
              ? {
                  testStatus: "active",
                  lastError: null,
                  lastErrorAt: null,
                  backoffLevel: 0,
                }
              : {}),
          }),
        ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json(
      { error: "Failed to clear cooldown" },
      { status: 500 },
    );
  }
}
