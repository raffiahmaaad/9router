import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

export async function GET() {
  try {
    if (isHostedMode()) {
      const settings = await callCloudAdmin("/admin/settings", { method: "GET" });
      return NextResponse.json(settings, { headers: SETTINGS_RESPONSE_HEADERS });
    }

    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    const { password, ...safeSettings } = settings;

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";

    return NextResponse.json({
      ...safeSettings,
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    if (isHostedMode()) {
      const settings = await callCloudAdmin("/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return NextResponse.json(settings, { headers: SETTINGS_RESPONSE_HEADERS });
    }

    const [{ getSettings, updateSettings }, { applyOutboundProxyEnv }, { resetComboRotation }] = await Promise.all([
      import("@/lib/localDb"),
      import("@/lib/network/outboundProxy"),
      import("open-sse/services/combo.js"),
    ]);

    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    const settings = await updateSettings(body);

    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    const { password, ...safeSettings } = settings;
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    if (isHostedMode()) return cloudAdminErrorResponse(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
