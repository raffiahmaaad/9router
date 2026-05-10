import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { isHostedMode } from "@/lib/runtimeMode";
import { callCloudAdmin } from "@/lib/hosted/cloudClient";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (isHostedMode() && token) {
    try {
      const { payload } = await jwtVerify(token, SECRET);
      if (payload.sessionId) {
        await callCloudAdmin("/admin/auth/logout", {
          method: "POST",
          headers: { "x-session-id": String(payload.sessionId) },
        });
      }
    } catch {}
  }

  cookieStore.delete("auth_token");
  return NextResponse.json({ success: true });
}
