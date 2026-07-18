import {
  calculateComparisons,
  calculateHandlingFee,
  chooseDefaultTier,
} from "../src/shared/calculation";
import type { FeeTier, RateQuote } from "../src/shared/types";

function tier(
  id: string,
  label: string,
  percent = 0.001,
  minimumCny = 20,
  maximumCny = 200,
  telegraphFeeUsCny: number | null = 100,
): FeeTier {
  return {
    id,
    bankId: "test",
    bankName: "测试银行",
    label,
    feeRule: { kind: "percentage", percent, minimumCny, maximumCny },
    telegraphFeeUsCny,
    rawFeeText: "fixture",
    rawTelegraphText: "fixture",
    officialUrl: null,
    remarks: null,
  };
}

describe("cost calculation", () => {
  it("applies minimum, proportional and maximum fee bounds", () => {
    const rule = tier("ordinary", "普通客户");
    expect(calculateHandlingFee(1_000, rule)).toBe(20);
    expect(calculateHandlingFee(100_000, rule)).toBe(100);
    expect(calculateHandlingFee(500_000, rule)).toBe(200);
  });

  it("prefers the ordinary electronic tier", () => {
    const tiers = [
      tier("vip", "白金客户"),
      tier("ordinary", "普通客户"),
      tier("online", "普通客户电子渠道"),
    ];
    expect(chooseDefaultTier(tiers)?.id).toBe("online");
  });

  it("sorts complete totals and keeps incomplete fee data visible", () => {
    const rates: RateQuote[] = [
      {
        bankId: "test",
        bankName: "测试银行",
        sellRateCnyPerUsd: 7,
        publishedAtText: "now",
        source: "national",
        sourceUrl: "https://example.com",
      },
      {
        bankId: "missing",
        bankName: "资料银行",
        sellRateCnyPerUsd: 6.9,
        publishedAtText: "now",
        source: "national",
        sourceUrl: "https://example.com",
      },
    ];

    const comparisons = calculateComparisons(10_000, rates, [
      tier("ordinary", "普通客户"),
    ]);
    expect(comparisons[0]).toEqual(
      expect.objectContaining({
        bankId: "test",
        exchangeCostCny: 70_000,
        handlingFeeCny: 70,
        telegraphFeeCny: 100,
        totalCostCny: 70_170,
        differenceFromBestCny: 0,
      }),
    );
    expect(comparisons[1].totalCostCny).toBeNull();
  });
});

