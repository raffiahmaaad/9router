import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

export async function POST() {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const [{ startLogin }, { loadState, generateShortId }] = await Promise.all([
      import("@/lib/tunnel/tailscale"),
      import("@/lib/tunnel/state.js"),
    ]);
    const shortId = loadState()?.shortId || generateShortId();
    const result = await startLogin(shortId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale login error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
