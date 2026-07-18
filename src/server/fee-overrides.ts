import type { FeeTier } from "../shared/types";

const LOCAL_NOTE = "本地修正规则，更新于 2026-07-18";
const OFFICIAL_URLS: Record<string, string> = {
  bob: "https://www.bankofbeijing.com.cn/personal/sfbz",
  cmb: "https://fin.paas.cmbchina.com/fininfo/serviceprice",
  hxb: "https://www.hxb.com.cn/jrhx/khfw/zxgg/2025/12/133395.shtml",
};

function updateOfficialUrls(tiers: FeeTier[]): FeeTier[] {
  return tiers.map((tier) => ({
    ...tier,
    officialUrl: OFFICIAL_URLS[tier.bankId] ?? tier.officialUrl,
  }));
}

function updateHuaxiaBank(tiers: FeeTier[]): FeeTier[] {
  const ordinary = tiers.find(
    (tier) => tier.bankId === "hxb" && tier.label === "普通",
  );
  if (!ordinary) return tiers;

  const mobileTier: FeeTier = {
    ...ordinary,
    id: "hxb-local-mobile-banking",
    label: "普通（手机银行）",
    feeRule: {
      kind: "percentage",
      percent: 0.0005,
      minimumCny: 20,
      maximumCny: 200,
    },
    rawFeeText: "汇款金额的0.05%,最低20元/笔,最高200元/笔",
    remarks: `${LOCAL_NOTE}：手机银行手续费按0.5‰收取，收费上下限沿用普通客户标准。`,
  };

  return [
    ...tiers.filter((tier) => tier.id !== mobileTier.id),
    mobileTier,
  ];
}

function updateChinaMerchantsBank(tiers: FeeTier[]): FeeTier[] {
  const ordinary = tiers.find(
    (tier) => tier.bankId === "cmb" && tier.label === "普通客户",
  );
  const updated = tiers.map((tier): FeeTier => {
    if (tier.bankId !== "cmb") return tier;

    const common = {
      ...tier,
      telegraphFeeUsCny: 100,
      rawTelegraphText: "100元/笔",
    };
    if (tier.label !== "普通客户") return common;

    return {
      ...common,
      feeRule: {
        kind: "percentage",
        percent: 0.001,
        minimumCny: 50,
        maximumCny: 280,
      },
      rawFeeText: "汇款金额的0.10%,最低50元/笔,最高280元/笔",
      remarks: `${LOCAL_NOTE}：普通客户手续费最低50元、最高280元；所有客户等级电报费100元。`,
    };
  });

  if (!ordinary) return updated;

  const goldTier: FeeTier = {
    ...ordinary,
    id: "cmb-local-gold-card",
    label: "金卡客户",
    feeRule: {
      kind: "percentage",
      percent: 0.0005,
      minimumCny: 50,
      maximumCny: 280,
    },
    telegraphFeeUsCny: 100,
    rawFeeText: "汇款金额的0.05%,最低50元/笔,最高280元/笔",
    rawTelegraphText: "100元/笔",
    remarks: `${LOCAL_NOTE}：金卡客户手续费按0.5‰收取，最低50元、最高280元；电报费100元。`,
  };

  return [
    ...updated.filter((tier) => tier.id !== goldTier.id),
    goldTier,
  ];
}

export function applyFeeOverrides(tiers: FeeTier[]): FeeTier[] {
  return updateOfficialUrls(
    updateChinaMerchantsBank(updateHuaxiaBank(updateOfficialUrls(tiers))),
  );
}
