import { handleChat } from "@/sse/handlers/chat.js";
import { isHostedMode, requireHostedEnv } from "@/lib/runtimeMode";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {  
  if (isHostedMode()) {
    const cloudUrl = requireHostedEnv("CLOUD_URL").replace(/\/+$/, "");
    const body = await request.text();
    const headers = new Headers(request.headers);
    headers.set("content-type", headers.get("content-type") || "application/json");
    headers.delete("host");

    return fetch(`${cloudUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });
  }

  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}
