import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (isHostedMode()) {
      const data = await callCloudAdmin(`/admin/api-keys/${id}`, { method: "GET" });
      return NextResponse.json(data);
    }
    const { getApiKeyById } = await import("@/lib/localDb");
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive } = body;

    if (isHostedMode()) {
      const data = await callCloudAdmin(`/admin/api-keys/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive }),
      });
      return NextResponse.json(data);
    }

    const { getApiKeyById, updateApiKey } = await import("@/lib/localDb");
    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    if (isHostedMode()) {
      const data = await callCloudAdmin(`/admin/api-keys/${id}`, { method: "DELETE" });
      return NextResponse.json(data);
    }

    const { deleteApiKey } = await import("@/lib/localDb");
    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
