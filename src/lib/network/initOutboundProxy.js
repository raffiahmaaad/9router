import { isHostedMode } from "@/lib/runtimeMode";

let initialized = false;

export async function ensureOutboundProxyInitialized() {
  if (isHostedMode()) return true;
  if (initialized) return true;

  try {
    const [{ getSettings }, { applyOutboundProxyEnv }] = await Promise.all([
      import("@/lib/localDb"),
      import("@/lib/network/outboundProxy"),
    ]);
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

if (!isHostedMode()) {
  setImmediate(() => {
    ensureOutboundProxyInitialized().catch(console.log);
  });
}

export default ensureOutboundProxyInitialized;
