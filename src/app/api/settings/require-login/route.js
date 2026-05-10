import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin } from "@/lib/hosted/cloudClient";

export async function GET() {
  try {
    const settings = isHostedMode()
      ? await callCloudAdmin("/admin/settings", { method: "GET" })
      : await (await import("@/lib/localDb")).getSettings();
    const requireLogin = settings.requireLogin !== false;
    const tunnelDashboardAccess = settings.tunnelDashboardAccess !== false;
    const tunnelUrl = settings.tunnelUrl || "";
    const tailscaleUrl = settings.tailscaleUrl || "";
    return NextResponse.json({ requireLogin, tunnelDashboardAccess, tunnelUrl, tailscaleUrl });
  } catch (error) {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
