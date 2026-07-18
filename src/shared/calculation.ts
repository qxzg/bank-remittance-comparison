import type {
  ComparisonResult,
  FeeTier,
  RateQuote,
} from "./types";

function roundCny(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isCalculable(tier: FeeTier): boolean {
  return tier.feeRule.kind !== "review" && tier.telegraphFeeUsCny !== null;
}

export function chooseDefaultTier(tiers: FeeTier[]): FeeTier | null {
  const ranked = [...tiers].sort((left, right) => {
    const score = (tier: FeeTier): number => {
      const label = tier.label;
      const ordinary = label.includes("普通");
      const electronic = /电子|网上|手机/.test(label);
      if (ordinary && electronic && isCalculable(tier)) return 0;
      if (/^普通客户?$/.test(label) && isCalculable(tier)) return 1;
      if (ordinary && isCalculable(tier)) return 2;
      if (isCalculable(tier)) return 3;
      return 4;
    };
    return score(left) - score(right);
  });
  return ranked[0] ?? null;
}

export function groupTiersByBank(tiers: FeeTier[]): Map<string, FeeTier[]> {
  const grouped = new Map<string, FeeTier[]>();
  for (const tier of tiers) {
    const bankTiers = grouped.get(tier.bankId) ?? [];
    bankTiers.push(tier);
    grouped.set(tier.bankId, bankTiers);
  }
  return grouped;
}

export function calculateHandlingFee(
  exchangeCostCny: number,
  tier: FeeTier,
): number | null {
  if (tier.feeRule.kind === "review") return null;
  if (tier.feeRule.kind === "free") return 0;
  const proportional = exchangeCostCny * tier.feeRule.percent;
  return roundCny(
    Math.min(
      tier.feeRule.maximumCny,
      Math.max(tier.feeRule.minimumCny, proportional),
    ),
  );
}

export function calculateComparisons(
  amountUsd: number,
  rates: RateQuote[],
  tiers: FeeTier[],
  selectedTierIds: Record<string, string> = {},
): ComparisonResult[] {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return [];
  const tiersByBank = groupTiersByBank(tiers);

  const comparisons = rates.map((rate): ComparisonResult => {
    const bankTiers = tiersByBank.get(rate.bankId) ?? [];
    const selectedTier = bankTiers.find(
      (tier) => tier.id === selectedTierIds[rate.bankId],
    );
    const tier = selectedTier ?? chooseDefaultTier(bankTiers);
    const exchangeCostCny = roundCny(amountUsd * rate.sellRateCnyPerUsd);
    const handlingFeeCny = tier
      ? calculateHandlingFee(exchangeCostCny, tier)
      : null;
    const telegraphFeeCny = tier?.telegraphFeeUsCny ?? null;
    const totalCostCny =
      handlingFeeCny !== null && telegraphFeeCny !== null
        ? roundCny(exchangeCostCny + handlingFeeCny + telegraphFeeCny)
        : null;

    return {
      bankId: rate.bankId,
      bankName: rate.bankName,
      rate,
      tier,
      exchangeCostCny,
      handlingFeeCny,
      telegraphFeeCny,
      totalCostCny,
      effectiveRate: totalCostCny === null ? null : totalCostCny / amountUsd,
      differenceFromBestCny: null,
    };
  });

  const bestTotal = Math.min(
    ...comparisons
      .map((item) => item.totalCostCny)
      .filter((value): value is number => value !== null),
  );

  for (const comparison of comparisons) {
    comparison.differenceFromBestCny =
      comparison.totalCostCny === null || !Number.isFinite(bestTotal)
        ? null
        : roundCny(comparison.totalCostCny - bestTotal);
  }

  return comparisons.sort((left, right) => {
    if (left.totalCostCny === null) return 1;
    if (right.totalCostCny === null) return -1;
    return left.totalCostCny - right.totalCostCny;
  });
}
