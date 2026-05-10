import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

export async function POST() {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { disableTunnel } = await import("@/lib/tunnel/tunnelManager");
    const result = await disableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel disable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
