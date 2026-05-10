import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";
import { isHostedMode } from "@/lib/runtimeMode";
import { resetComboRotation } from "open-sse/services/combo.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (isHostedMode()) {
      const combo = await callCloudAdmin(`/admin/combos/${id}`, { method: "GET" });
      return NextResponse.json(combo);
    }
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      if (isHostedMode()) {
        const data = await callCloudAdmin("/admin/combos", { method: "GET" });
        if ((data.combos || []).some((combo) => combo.name === body.name && combo.id !== id)) {
          return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
        }
      } else {
        const existing = await getComboByName(body.name);
        if (existing && existing.id !== id) {
          return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
        }
      }
    }

    const prev = isHostedMode()
      ? await callCloudAdmin(`/admin/combos/${id}`, { method: "GET" })
      : await getComboById(id);
    const combo = isHostedMode()
      ? await callCloudAdmin(`/admin/combos/${id}`, { method: "PUT", body: JSON.stringify(body) })
      : await updateCombo(id, body);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prev = isHostedMode()
      ? await callCloudAdmin(`/admin/combos/${id}`, { method: "GET" })
      : await getComboById(id);
    const success = isHostedMode()
      ? await callCloudAdmin(`/admin/combos/${id}`, { method: "DELETE" })
      : await deleteCombo(id);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
