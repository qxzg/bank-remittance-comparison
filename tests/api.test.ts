import path from "node:path";
import request from "supertest";
import { createApp } from "../src/server/app";
import type { RatesResponse } from "../src/shared/types";

const responseFixture: RatesResponse = {
  rates: [],
  fetchedAt: "2026-07-18T00:00:00.000Z",
  stale: false,
  cached: false,
  sources: [
    { source: "national", status: "live" },
    { source: "beijing", status: "live" },
  ],
};

describe("HTTP API", () => {
  const app = createApp({
    feesPath: path.resolve("data/fees.json"),
    rateService: { getRates: vi.fn(async () => responseFixture) },
  });

  it("reports health and serves the local fee snapshot", async () => {
    const health = await request(app).get("/api/health").expect(200);
    expect(health.body.ok).toBe(true);

    const fees = await request(app).get("/api/fees").expect(200);
    expect(fees.body.version).toBe(1);
    expect(fees.body.snapshotType).toBe("fixed-local");
    expect(fees.body.tiers.length).toBe(40);
    expect(fees.headers["cache-control"]).toContain("no-store");
    const officialUrls = new Map(
      fees.body.tiers.map((tier: { bankId: string; officialUrl: string }) => [
        tier.bankId,
        tier.officialUrl,
      ]),
    );
    expect(officialUrls.get("bob")).toBe(
      "https://www.bankofbeijing.com.cn/personal/sfbz",
    );
    expect(officialUrls.get("cmb")).toBe(
      "https://fin.paas.cmbchina.com/fininfo/serviceprice",
    );
    expect(officialUrls.get("hxb")).toBe(
      "https://www.hxb.com.cn/jrhx/khfw/zxgg/2025/12/133395.shtml",
    );
  });

  it("serves normalized rates", async () => {
    const result = await request(app).get("/api/rates?refresh=1").expect(200);
    expect(result.body).toEqual(responseFixture);
  });
});
