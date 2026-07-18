import { applyFeeOverrides } from "../scripts/fee-overrides";
import type { FeeTier } from "../src/shared/types";

function percentageTier(
  bankId: string,
  bankName: string,
  label: string,
  minimumCny: number,
  maximumCny: number,
): FeeTier {
  return {
    id: `${bankId}-${label}`,
    bankId,
    bankName,
    label,
    feeRule: {
      kind: "percentage",
      percent: 0.001,
      minimumCny,
      maximumCny,
    },
    telegraphFeeUsCny: 150,
    rawFeeText: "fixture",
    rawTelegraphText: "fixture",
    officialUrl: "https://example.com/fees",
    remarks: null,
  };
}

describe("local fee overrides", () => {
  const sourceTiers: FeeTier[] = [
    percentageTier("hxb", "华夏银行", "普通", 20, 200),
    percentageTier("cmb", "招商银行", "普通客户", 100, 1_000),
    {
      ...percentageTier("cmb", "招商银行", "金葵花客户", 0, 0),
      feeRule: {
        kind: "free",
        percent: 0,
        minimumCny: 0,
        maximumCny: 0,
      },
    },
  ];

  it("adds the Huaxia mobile banking rate with unchanged bounds", () => {
    const result = applyFeeOverrides(sourceTiers);
    const mobile = result.find((tier) => tier.id === "hxb-local-mobile-banking");
    expect(mobile).toEqual(
      expect.objectContaining({
        label: "普通（手机银行）",
        feeRule: {
          kind: "percentage",
          percent: 0.0005,
          minimumCny: 20,
          maximumCny: 200,
        },
      }),
    );
  });

  it("updates all CMB wire fees and adds the gold tier", () => {
    const result = applyFeeOverrides(sourceTiers);
    const cmbTiers = result.filter((tier) => tier.bankId === "cmb");
    expect(cmbTiers.every((tier) => tier.telegraphFeeUsCny === 100)).toBe(true);
    expect(
      cmbTiers.every(
        (tier) =>
          tier.officialUrl ===
          "https://fin.paas.cmbchina.com/fininfo/serviceprice",
      ),
    ).toBe(true);

    const ordinary = cmbTiers.find((tier) => tier.label === "普通客户");
    expect(ordinary?.feeRule).toEqual({
      kind: "percentage",
      percent: 0.001,
      minimumCny: 50,
      maximumCny: 280,
    });

    const gold = cmbTiers.find((tier) => tier.label === "金卡客户");
    expect(gold?.feeRule).toEqual({
      kind: "percentage",
      percent: 0.0005,
      minimumCny: 50,
      maximumCny: 280,
    });
    expect(cmbTiers.find((tier) => tier.label === "金葵花客户")?.feeRule.kind).toBe(
      "free",
    );
  });

  it("is idempotent", () => {
    const once = applyFeeOverrides(sourceTiers);
    const twice = applyFeeOverrides(once);
    expect(twice).toEqual(once);
  });

  it("updates the Huaxia official fee URL", () => {
    const result = applyFeeOverrides(sourceTiers);
    expect(
      result
        .filter((tier) => tier.bankId === "hxb")
        .every(
          (tier) =>
            tier.officialUrl ===
            "https://www.hxb.com.cn/jrhx/khfw/zxgg/2025/12/133395.shtml",
        ),
    ).toBe(true);
  });
});
