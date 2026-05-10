"use server";

import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

export async function POST(request) {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const [{ startDaemonWithPassword }, manager, localDb] = await Promise.all([
      import("@/lib/tunnel/tailscale"),
      import("@/mitm/manager"),
      import("@/lib/localDb"),
    ]);
    manager.initDbHooks(localDb.getSettings, localDb.updateSettings);

    const body = await request.json().catch(() => ({}));
    const password = body.sudoPassword || manager.getCachedPassword() || await manager.loadEncryptedPassword() || "";
    await startDaemonWithPassword(password);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tailscale start daemon error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
