import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    if (isHostedMode()) {
      const data = await callCloudAdmin("/admin/api-keys", { method: "GET" });
      return NextResponse.json(data);
    }
    const { getApiKeys } = await import("@/lib/localDb");
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (isHostedMode()) {
      const apiKey = await callCloudAdmin("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      return NextResponse.json(apiKey, { status: 201 });
    }

    const [{ createApiKey }, { getConsistentMachineId }] = await Promise.all([
      import("@/lib/localDb"),
      import("@/shared/utils/machineId"),
    ]);
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
