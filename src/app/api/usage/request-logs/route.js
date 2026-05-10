import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { hostedUsageError, proxyHostedUsage, shouldProxyHostedUsage } from "@/lib/hosted/usageProxy";

export async function GET(request) {
  try {
    if (shouldProxyHostedUsage()) {
      return proxyHostedUsage("/admin/usage/request-logs", request);
    }

    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    if (shouldProxyHostedUsage()) return hostedUsageError(error);
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
