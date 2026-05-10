import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { hostedUsageError, proxyHostedUsage, shouldProxyHostedUsage } from "@/lib/hosted/usageProxy";

export async function GET(request) {
  try {
    if (shouldProxyHostedUsage()) {
      return proxyHostedUsage("/admin/usage/stats", request);
    }

    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    if (shouldProxyHostedUsage()) return hostedUsageError(error);
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
