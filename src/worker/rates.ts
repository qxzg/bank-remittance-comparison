import type {
  RateQuote,
  RatesResponse,
  SourceStatus,
} from "../shared/types";
import {
  BEIJING_RATES_URL,
  NATIONAL_RATES_URL,
  parseBeijingBankRateResponse,
  parseNationalRatesResponse,
} from "./rate-parser";

export interface Env {
  RATE_CACHE: KVNamespace;
}

export type UpstreamFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const RATE_CACHE_KEY = "rates:usd:latest";
export const RATE_CACHE_URL = "https://remittance.hx-sun.com/api/rates";
export const RATE_CACHE_CONTROL =
  "max-age=30, s-maxage=60, stale-while-revalidate=300";
export const STALE_AFTER_MS = 15 * 60 * 1_000;

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "zh-CN,zh;q=0.9",
  "user-agent": "BankRemittanceComparisonWorker/1.0",
};

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface RefreshOptions {
  fetcher?: UpstreamFetcher;
  now?: number;
  cache?: Cache;
}

function ratesCacheKey(): Request {
  return new Request(RATE_CACHE_URL, { method: "GET" });
}

export function materializeSnapshot(
  snapshot: RatesResponse,
  cached: boolean,
  now = Date.now(),
): RatesResponse {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  const expired = !Number.isFinite(fetchedAt) || now - fetchedAt > STALE_AFTER_MS;
  const degraded = snapshot.sources.some((source) => source.status !== "live");
  return {
    ...snapshot,
    cached,
    stale: expired || degraded,
  };
}

export function ratesJsonResponse(snapshot: RatesResponse): Response {
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": RATE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function fetchUpstream(
  url: string,
  fetcher: UpstreamFetcher,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher(url, {
        headers: REQUEST_HEADERS,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Response(response.body, {
        headers: {
          "Content-Type":
            response.headers.get("Content-Type") ?? "text/html; charset=utf-8",
        },
      });
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("上游抓取失败");
}

async function loadStoredSnapshot(env: Env): Promise<RatesResponse | null> {
  return env.RATE_CACHE.get<RatesResponse>(RATE_CACHE_KEY, "json");
}

export async function storeSnapshot(
  env: Env,
  snapshot: RatesResponse,
  cache: Cache = caches.default,
): Promise<void> {
  await Promise.all([
    env.RATE_CACHE.put(RATE_CACHE_KEY, JSON.stringify(snapshot)),
    cache.put(ratesCacheKey(), ratesJsonResponse(snapshot)),
  ]);
}

export async function refreshRates(
  env: Env,
  options: RefreshOptions = {},
): Promise<RatesResponse> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const cache = options.cache ?? caches.default;
  const previous = await loadStoredSnapshot(env);

  const [nationalResult, beijingResult] = await Promise.allSettled([
    fetchUpstream(NATIONAL_RATES_URL, fetcher).then(parseNationalRatesResponse),
    fetchUpstream(BEIJING_RATES_URL, fetcher).then(
      parseBeijingBankRateResponse,
    ),
  ]);

  if (
    nationalResult.status === "rejected" ||
    nationalResult.value.length === 0
  ) {
    console.error(
      JSON.stringify({
        event: "national_rates_source_failed",
        message:
          nationalResult.status === "rejected"
            ? nationalResult.reason instanceof Error
              ? nationalResult.reason.message
              : String(nationalResult.reason)
            : "美元牌价表为空",
      }),
    );
    if (previous) {
      const fallback: RatesResponse = {
        ...previous,
        cached: true,
        stale: true,
        sources: [
          {
            source: "national",
            status: "cached",
            message: "全国性银行牌价抓取失败，已显示最近成功数据",
          },
          {
            source: "beijing",
            status: "cached",
            message: "北京银行牌价沿用最近成功数据",
          },
        ],
      };
      await storeSnapshot(env, fallback, cache);
      return fallback;
    }
    throw new UpstreamError("全国性银行牌价源暂时无法访问");
  }

  const sources: SourceStatus[] = [{ source: "national", status: "live" }];
  let beijingRate: RateQuote | null =
    beijingResult.status === "fulfilled" ? beijingResult.value : null;

  if (beijingRate) {
    sources.push({ source: "beijing", status: "live" });
  } else {
    beijingRate =
      previous?.rates.find((rate) => rate.bankId === "bob") ?? null;
    sources.push({
      source: "beijing",
      status: beijingRate ? "cached" : "error",
      message: beijingRate
        ? "北京银行牌价抓取失败，已显示最近成功数据"
        : "北京银行牌价暂时缺失",
    });
  }

  const merged = new Map(
    nationalResult.value.map((rate) => [rate.bankId, rate]),
  );
  if (beijingRate) merged.set(beijingRate.bankId, beijingRate);

  const snapshot: RatesResponse = {
    rates: [...merged.values()],
    fetchedAt: new Date(now).toISOString(),
    cached: false,
    stale: sources.some((source) => source.status !== "live"),
    sources,
  };
  await storeSnapshot(env, snapshot, cache);
  return snapshot;
}

let coldStartInFlight: Promise<RatesResponse> | null = null;

async function createColdStartSnapshot(env: Env): Promise<RatesResponse> {
  if (coldStartInFlight) return coldStartInFlight;
  coldStartInFlight = refreshRates(env);
  try {
    return await coldStartInFlight;
  } finally {
    coldStartInFlight = null;
  }
}

export async function getRates(
  env: Env,
  forceKvRead = false,
  now = Date.now(),
): Promise<RatesResponse> {
  const cache = caches.default;

  if (!forceKvRead) {
    const cachedResponse = await cache.match(ratesCacheKey());
    if (cachedResponse) {
      const snapshot = await cachedResponse.json<RatesResponse>();
      return materializeSnapshot(snapshot, true, now);
    }
  }

  const stored = await loadStoredSnapshot(env);
  if (stored) {
    const snapshot = materializeSnapshot(stored, true, now);
    await cache.put(ratesCacheKey(), ratesJsonResponse(snapshot));
    return snapshot;
  }

  return createColdStartSnapshot(env);
}
