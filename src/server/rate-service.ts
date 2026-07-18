import type {
  RateQuote,
  RatesResponse,
  SourceStatus,
} from "../shared/types";
import {
  BEIJING_RATES_URL,
  NATIONAL_RATES_URL,
  parseBeijingBankRateHtml,
  parseNationalRatesHtml,
} from "./parsers";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "zh-CN,zh;q=0.9",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/132 Safari/537.36 BankRemittanceComparison/1.0",
};

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export type HtmlFetcher = (url: string) => Promise<string>;

export async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("上游抓取失败");
}

export class RateService {
  private cache: RatesResponse | null = null;
  private cacheExpiresAt = 0;
  private inFlight: Promise<RatesResponse> | null = null;

  constructor(
    private readonly htmlFetcher: HtmlFetcher = fetchHtml,
    private readonly cacheTtlMs = 30_000,
  ) {}

  async getRates(forceRefresh = false): Promise<RatesResponse> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const now = Date.now();
    if (!forceRefresh && this.cache && now < this.cacheExpiresAt) {
      return { ...this.cache, cached: true };
    }

    const refresh = this.refreshRates();
    this.inFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.inFlight === refresh) {
        this.inFlight = null;
      }
    }
  }

  private async refreshRates(): Promise<RatesResponse> {
    const now = Date.now();
    const [nationalResult, beijingResult] = await Promise.allSettled([
      this.htmlFetcher(NATIONAL_RATES_URL),
      this.htmlFetcher(BEIJING_RATES_URL),
    ]);
    const fetchedAt = new Date().toISOString();
    const sources: SourceStatus[] = [];

    if (nationalResult.status === "rejected") {
      if (this.cache) {
        return {
          ...this.cache,
          fetchedAt,
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
      }
      throw new UpstreamError("全国性银行牌价源暂时无法访问");
    }

    const nationalRates = parseNationalRatesHtml(nationalResult.value);
    if (nationalRates.length === 0) {
      if (this.cache) {
        return {
          ...this.cache,
          fetchedAt,
          cached: true,
          stale: true,
          sources: [
            {
              source: "national",
              status: "cached",
              message: "全国性银行页面结构发生变化，已显示最近成功数据",
            },
            { source: "beijing", status: "cached" },
          ],
        };
      }
      throw new UpstreamError("全国性银行牌价页面中未找到美元牌价");
    }
    sources.push({ source: "national", status: "live" });

    let beijingRate: RateQuote | null = null;
    if (beijingResult.status === "fulfilled") {
      beijingRate = parseBeijingBankRateHtml(beijingResult.value);
    }

    if (beijingRate) {
      sources.push({ source: "beijing", status: "live" });
    } else {
      beijingRate = this.cache?.rates.find((rate) => rate.bankId === "bob") ?? null;
      sources.push({
        source: "beijing",
        status: beijingRate ? "cached" : "error",
        message: beijingRate
          ? "北京银行牌价抓取失败，已显示最近成功数据"
          : "北京银行牌价暂时缺失",
      });
    }

    const merged = new Map(nationalRates.map((rate) => [rate.bankId, rate]));
    if (beijingRate) merged.set(beijingRate.bankId, beijingRate);

    const response: RatesResponse = {
      rates: [...merged.values()],
      fetchedAt,
      cached: false,
      stale: sources.some((source) => source.status !== "live"),
      sources,
    };
    this.cache = response;
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return response;
  }
}
