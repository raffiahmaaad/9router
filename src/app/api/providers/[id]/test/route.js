import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";
import { testSingleConnection, testConnectionRecord } from "./testUtils.js";

async function testHostedConnection(id) {
  const data = await callCloudAdmin(`/admin/providers/${id}?includeSecrets=1`, {
    method: "GET",
  });
  const connection = data?.connection;
  if (!connection) {
    return { valid: false, error: "Connection not found" };
  }

  const hasSecret = !!(connection.apiKey || connection.accessToken);
  if (!hasSecret) {
    return {
      valid: false,
      error: "Cloud worker returned no credentials. Redeploy the Cloudflare worker to enable hosted Test Connection.",
    };
  }

  const result = await testConnectionRecord(connection);

  const updatePayload = {
    testStatus: result.valid ? "active" : "error",
    lastError: result.valid ? null : result.error,
    lastErrorAt: result.valid ? null : new Date().toISOString(),
  };

  if (result.refreshed && result.newTokens) {
    updatePayload.accessToken = result.newTokens.accessToken;
    if (result.newTokens.refreshToken) updatePayload.refreshToken = result.newTokens.refreshToken;
    if (result.newTokens.expiresIn) {
      updatePayload.expiresAt = new Date(Date.now() + result.newTokens.expiresIn * 1000).toISOString();
    }
  }

  try {
    await callCloudAdmin(`/admin/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(updatePayload),
    });
  } catch (err) {
    console.log("Failed to persist hosted test result:", err?.message || err);
  }

  return {
    valid: result.valid,
    error: result.error,
    refreshed: !!result.refreshed,
  };
}

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const result = isHostedMode()
      ? await testHostedConnection(id)
      : await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
