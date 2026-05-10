import { requireHostedEnv } from "@/lib/runtimeMode";

function getCloudConfig() {
  return {
    baseUrl: requireHostedEnv("CLOUD_URL").replace(/\/+$/, ""),
    adminSecret: requireHostedEnv("CLOUD_ADMIN_SECRET"),
  };
}

export async function callCloudAdmin(path, options = {}) {
  const { baseUrl, adminSecret } = getCloudConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminSecret}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error || "Cloud admin API request failed");
    error.code = data?.code || "UPSTREAM_ADMIN_API_ERROR";
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function cloudAdminErrorResponse(error) {
  const status = error.code === "MISSING_HOSTED_CONFIG" ? 500 : error.status || 502;
  return Response.json(
    {
      error: error.message,
      code: error.code || "UPSTREAM_ADMIN_API_ERROR",
    },
    { status }
  );
}
