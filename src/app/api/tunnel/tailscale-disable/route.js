import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

export async function POST() {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { disableTailscale } = await import("@/lib/tunnel/tunnelManager");
    const result = await disableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale disable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
