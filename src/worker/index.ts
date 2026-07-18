import type { Env } from "./rates";
import {
  UpstreamError,
  getRates,
  ratesJsonResponse,
  refreshRates,
} from "./rates";

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "牌价服务异常";
  return Response.json(
    { error: message },
    {
      status: error instanceof UpstreamError ? 502 : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

const worker = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true, timestamp: new Date().toISOString() });
    }

    if (request.method === "GET" && url.pathname === "/api/rates") {
      try {
        const snapshot = await getRates(
          env,
          url.searchParams.get("refresh") === "1",
        );
        return ratesJsonResponse(snapshot);
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "API endpoint not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return new Response(null, { status: 404 });
  },

  scheduled(controller, env, ctx): void {
    ctx.waitUntil(
      refreshRates(env)
        .then((snapshot) => {
          console.log(
            JSON.stringify({
              event: "rates_refreshed",
              cron: controller.cron,
              fetchedAt: snapshot.fetchedAt,
              rateCount: snapshot.rates.length,
              stale: snapshot.stale,
              sources: snapshot.sources,
            }),
          );
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "rates_refresh_failed",
              cron: controller.cron,
              message:
                error instanceof Error ? error.message : "牌价服务异常",
            }),
          );
          throw error;
        }),
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
