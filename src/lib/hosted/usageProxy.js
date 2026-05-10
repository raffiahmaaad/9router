import { callCloudAdmin, cloudAdminErrorResponse } from "@/lib/hosted/cloudClient";
import { isHostedMode } from "@/lib/runtimeMode";

export function shouldProxyHostedUsage() {
  return isHostedMode();
}

export async function proxyHostedUsage(path, request) {
  const source = new URL(request.url);
  const query = source.search || "";
  return Response.json(await callCloudAdmin(`${path}${query}`, { method: "GET" }));
}

export function hostedUsageError(error) {
  return cloudAdminErrorResponse(error);
}
