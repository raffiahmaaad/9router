import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";
import { callCloudAdmin } from "@/lib/hosted/cloudClient";
import { isHostedMode } from "@/lib/runtimeMode";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  if (isHostedMode()) {
    // Poll the cloud worker periodically and push updates over SSE so the
    // dashboard reflects new requests in near real time.
    const POLL_INTERVAL_MS = 4000;
    const KEEPALIVE_MS = 25000;
    const state = { closed: false, poll: null, keepalive: null };

    const stream = new ReadableStream({
      async start(controller) {
        let lastPayload = null;

        const push = async () => {
          if (state.closed) return;
          try {
            const stats = await callCloudAdmin("/admin/usage/stats", { method: "GET" });
            const json = JSON.stringify(stats);
            if (json !== lastPayload) {
              lastPayload = json;
              controller.enqueue(encoder.encode(`data: ${json}\n\n`));
            }
          } catch {
            // keep connection alive even if one poll fails
          }
        };

        await push();

        state.poll = setInterval(() => { push(); }, POLL_INTERVAL_MS);
        state.keepalive = setInterval(() => {
          if (state.closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            state.closed = true;
          }
        }, KEEPALIVE_MS);
      },
      cancel() {
        state.closed = true;
        clearInterval(state.poll);
        clearInterval(state.keepalive);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const state = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache
          const stats = await getUsageStats();
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      await state.send();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
