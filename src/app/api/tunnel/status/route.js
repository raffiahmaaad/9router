import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

export async function GET() {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const [{ getTunnelStatus, getTailscaleStatus }, { getDownloadStatus }] = await Promise.all([
      import("@/lib/tunnel/tunnelManager"),
      import("@/lib/tunnel/cloudflared"),
    ]);
    const [tunnel, tailscale] = await Promise.all([getTunnelStatus(), getTailscaleStatus()]);
    const download = getDownloadStatus();
    return NextResponse.json({ tunnel, tailscale, download });
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
