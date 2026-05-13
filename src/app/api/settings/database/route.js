import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";

async function exportHostedDb() {
  const [providers, combos, proxyPools, apiKeys, nodes, settings, aliases] = await Promise.all([
    callCloudAdmin("/admin/providers", { method: "GET" }).catch(() => ({ connections: [] })),
    callCloudAdmin("/admin/combos", { method: "GET" }).catch(() => ({ combos: [] })),
    callCloudAdmin("/admin/proxy-pools", { method: "GET" }).catch(() => ({ proxyPools: [] })),
    callCloudAdmin("/admin/api-keys", { method: "GET" }).catch(() => ({ keys: [] })),
    callCloudAdmin("/admin/provider-nodes", { method: "GET" }).catch(() => ({ nodes: [] })),
    callCloudAdmin("/admin/settings", { method: "GET" }).catch(() => ({})),
    callCloudAdmin("/admin/models/alias", { method: "GET" }).catch(() => ({ aliases: {} })),
  ]);

  return {
    settings: settings || {},
    providerConnections: providers.connections || [],
    providerNodes: nodes.nodes || [],
    proxyPools: proxyPools.proxyPools || [],
    apiKeys: apiKeys.keys || [],
    combos: combos.combos || [],
    modelAliases: aliases.aliases || {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
    _hostedMode: true,
    _exportedAt: new Date().toISOString(),
  };
}

export async function GET() {
  if (isHostedMode()) {
    try {
      const payload = await exportHostedDb();
      return NextResponse.json(payload);
    } catch (error) {
      console.log("Error exporting hosted database:", error);
      return cloudAdminErrorResponse(error);
    }
  }

  try {
    const { exportDb } = await import("@/lib/localDb");
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  if (isHostedMode()) {
    // Importing into hosted mode is not supported — would overwrite shared cloud state.
    return NextResponse.json(
      {
        error: "Importing a backup into hosted mode is not supported. Switch to local mode to restore a backup.",
        code: "HOSTED_IMPORT_UNSUPPORTED",
      },
      { status: 409 }
    );
  }

  try {
    const [{ importDb, getSettings }, { applyOutboundProxyEnv }] = await Promise.all([
      import("@/lib/localDb"),
      import("@/lib/network/outboundProxy"),
    ]);
    const payload = await request.json();
    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
