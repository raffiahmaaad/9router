import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { enableTunnel } = await import("@/lib/tunnel/tunnelManager");
    const result = await enableTunnel();
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
