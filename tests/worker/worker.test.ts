import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RatesResponse } from "../../src/shared/types";
import worker from "../../src/worker";
import {
  parseBeijingBankRateResponse,
  parseNationalRatesResponse,
} from "../../src/worker/rate-parser";
import type { Env as WorkerEnv, UpstreamFetcher } from "../../src/worker/rates";
import {
  RATE_CACHE_KEY,
  RATE_CACHE_URL,
  STALE_AFTER_MS,
  refreshRates,
  storeSnapshot,
} from "../../src/worker/rates";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends WorkerEnv {}
}

const nationalHtml = `
  <table id="bank_rate_usd"><tbody>
    <tr>
      <td>&nbsp;中国银行</td><td>6.70</td><td>6.60</td>
      <td>&nbsp;6.812345 <i>best</i></td><td>6.90</td><td>07月18日 10:20</td>
    </tr>
    <tr><td>空牌价银行</td><td>--</td><td>--</td><td>--</td><td>--</td><td>--</td></tr>
  </tbody></table>`;

const beijingHtml = `
  <table id="bank_rate"><tbody>
    <tr><td>中国银行</td><td>全国性</td><td>6.7</td><td>6.6</td><td>6.81</td><td>6.9</td><td>07月18日 10:00</td></tr>
    <tr><td>&nbsp;北京银行</td><td>地方性</td><td>6.7</td><td>6.6</td><td>&nbsp;6.79</td><td>6.9</td><td>07月18日 10:10</td></tr>
  </tbody></table>`;

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function successfulFetcher() {
  return vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("110100")
      ? htmlResponse(beijingHtml)
      : htmlResponse(nationalHtml),
  );
}

function snapshot(
  fetchedAt = "2026-07-18T04:00:00.000Z",
): RatesResponse {
  return {
    fetchedAt,
    cached: false,
    stale: false,
    sources: [
      { source: "national", status: "live" },
      { source: "beijing", status: "live" },
    ],
    rates: [
      {
        bankId: "boc",
        bankName: "中国银行",
        sellRateCnyPerUsd: 6.81,
        publishedAtText: "07月18日 10:00",
        source: "national",
        sourceUrl: "https://www.kylc.com/bank/rmbfx.html?ccy=usd",
      },
      {
        bankId: "bob",
        bankName: "北京银行",
        sellRateCnyPerUsd: 6.79,
        publishedAtText: "07月18日 10:10",
        source: "beijing",
        sourceUrl:
          "https://www.kylc.com/huilv/bank/perccy/usd/110100.html",
      },
    ],
  };
}

async function callWorker(path: string): Promise<Response> {
  return worker.fetch(
    new Request(`https://remittance.hx-sun.com${path}`),
    env,
    createExecutionContext(),
  );
}

beforeEach(async () => {
  await Promise.all([
    env.RATE_CACHE.delete(RATE_CACHE_KEY),
    caches.default.delete(new Request(RATE_CACHE_URL)),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HTMLRewriter rate parsers", () => {
  it("parses both live USD rate tables", async () => {
    const national = await parseNationalRatesResponse(
      htmlResponse(nationalHtml),
    );
    const beijing = await parseBeijingBankRateResponse(
      htmlResponse(beijingHtml),
    );

    expect(national).toEqual([
      expect.objectContaining({
        bankId: "boc",
        sellRateCnyPerUsd: 6.812345,
        publishedAtText: "07月18日 10:20",
      }),
    ]);
    expect(beijing).toEqual(
      expect.objectContaining({ bankId: "bob", sellRateCnyPerUsd: 6.79 }),
    );
  });

  it("stops consuming transformed output after the target table", async () => {
    const encoder = new TextEncoder();
    let trailingPulls = 0;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(nationalHtml));
        },
        pull(controller) {
          trailingPulls += 1;
          controller.enqueue(encoder.encode("<div>unused trailing page</div>"));
        },
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

    expect(await parseNationalRatesResponse(response)).toHaveLength(1);
    expect(trailingPulls).toBeLessThanOrEqual(1);
  });
});

describe("scheduled refresh and source fallback", () => {
  it("writes a merged snapshot to KV from the Cron handler", async () => {
    const fetcher = successfulFetcher();
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ctx = createExecutionContext();

    worker.scheduled(
      createScheduledController({
        cron: "*/5 * * * *",
        scheduledTime: Date.now(),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const stored = await env.RATE_CACHE.get<RatesResponse>(
      RATE_CACHE_KEY,
      "json",
    );
    expect(stored?.rates.map((rate) => rate.bankId)).toEqual(["boc", "bob"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves the complete previous snapshot when the national source fails", async () => {
    const previous = snapshot();
    await env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(previous));
    const fetcher: UpstreamFetcher = async (input) =>
      String(input).includes("110100")
        ? htmlResponse(beijingHtml)
        : htmlResponse("upstream unavailable", 503);

    const result = await refreshRates(env, { fetcher });

    expect(result.rates).toEqual(previous.rates);
    expect(result.fetchedAt).toBe(previous.fetchedAt);
    expect(result.stale).toBe(true);
    expect(result.sources.every((source) => source.status === "cached")).toBe(
      true,
    );
  });

  it("merges the previous Beijing Bank quote when its source fails", async () => {
    const previous = snapshot();
    await env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(previous));
    const fetcher: UpstreamFetcher = async (input) =>
      String(input).includes("110100")
        ? htmlResponse("upstream unavailable", 503)
        : htmlResponse(nationalHtml);

    const result = await refreshRates(env, { fetcher });

    expect(result.rates.map((rate) => rate.bankId)).toEqual(["boc", "bob"]);
    expect(result.rates.find((rate) => rate.bankId === "bob")).toEqual(
      previous.rates[1],
    );
    expect(result.sources.at(-1)?.status).toBe("cached");
    expect(result.stale).toBe(true);
  });
});

describe("Worker API cache path", () => {
  it("serves health and JSON API 404 responses", async () => {
    const health = await callWorker("/api/health");
    const missing = await callWorker("/api/missing");

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual(
      expect.objectContaining({ ok: true, timestamp: expect.any(String) }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "API endpoint not found" });
  });

  it("creates the first snapshot synchronously on a cold start", async () => {
    const fetcher = successfulFetcher();
    vi.stubGlobal("fetch", fetcher);

    const response = await callWorker("/api/rates");
    const result = await response.json<RatesResponse>();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "max-age=30, s-maxage=60, stale-while-revalidate=300",
    );
    expect(result.cached).toBe(false);
    expect(result.rates).toHaveLength(2);
    expect(await env.RATE_CACHE.get(RATE_CACHE_KEY)).toBeTruthy();
  });

  it("uses one Cache API entry for every query string", async () => {
    const fetcher = successfulFetcher();
    vi.stubGlobal("fetch", fetcher);

    await callWorker("/api/rates");
    const changed = snapshot();
    changed.rates[0].sellRateCnyPerUsd = 7.25;
    await env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(changed));

    const response = await callWorker("/api/rates?amount=5000");
    const result = await response.json<RatesResponse>();
    expect(result.cached).toBe(true);
    expect(result.rates[0].sellRateCnyPerUsd).toBe(6.812345);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fills the Cache API from an existing KV snapshot", async () => {
    await env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(snapshot()));
    const fetcher = vi.fn(() => Promise.reject(new Error("unexpected fetch")));
    vi.stubGlobal("fetch", fetcher);

    const response = await callWorker("/api/rates");
    const result = await response.json<RatesResponse>();

    expect(result.cached).toBe(true);
    expect(result.rates).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(0);
    expect(await caches.default.match(new Request(RATE_CACHE_URL))).toBeTruthy();
  });

  it("reads KV immediately on refresh and replaces the shared cache entry", async () => {
    const oldSnapshot = snapshot();
    await storeSnapshot(env, oldSnapshot);
    const latest = snapshot("2026-07-18T04:05:00.000Z");
    latest.rates[0].sellRateCnyPerUsd = 6.75;
    await env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(latest));

    const refreshed = await callWorker("/api/rates?refresh=1");
    const ordinary = await callWorker("/api/rates?anything=1");

    expect((await refreshed.json<RatesResponse>()).rates[0].sellRateCnyPerUsd).toBe(
      6.75,
    );
    expect((await ordinary.json<RatesResponse>()).rates[0].sellRateCnyPerUsd).toBe(
      6.75,
    );
  });

  it("marks snapshots older than fifteen minutes as stale", async () => {
    const now = Date.now();
    const oldSnapshot = snapshot(
      new Date(now - STALE_AFTER_MS - 1_000).toISOString(),
    );
    await env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(oldSnapshot));

    const response = await callWorker("/api/rates");
    expect((await response.json<RatesResponse>()).stale).toBe(true);
  });
});
