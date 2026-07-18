export type FeeRule =
  | {
      kind: "free";
      percent: 0;
      minimumCny: 0;
      maximumCny: 0;
    }
  | {
      kind: "percentage";
      percent: number;
      minimumCny: number;
      maximumCny: number;
    }
  | {
      kind: "review";
      reason: string;
    };

export interface FeeTier {
  id: string;
  bankId: string;
  bankName: string;
  label: string;
  feeRule: FeeRule;
  telegraphFeeUsCny: number | null;
  rawFeeText: string;
  rawTelegraphText: string;
  officialUrl: string | null;
  remarks: string | null;
}

export interface FeeSnapshot {
  version: 1;
  snapshotType: "fixed-local";
  sourceUrl: string;
  capturedAt: string;
  manualOverrides: string[];
  tiers: FeeTier[];
}

export interface RateQuote {
  bankId: string;
  bankName: string;
  sellRateCnyPerUsd: number;
  publishedAtText: string;
  source: "national" | "beijing";
  sourceUrl: string;
}

export interface SourceStatus {
  source: "national" | "beijing";
  status: "live" | "cached" | "error";
  message?: string;
}

export interface RatesResponse {
  rates: RateQuote[];
  fetchedAt: string;
  stale: boolean;
  cached: boolean;
  sources: SourceStatus[];
}

export interface ComparisonResult {
  bankId: string;
  bankName: string;
  rate: RateQuote;
  tier: FeeTier | null;
  exchangeCostCny: number;
  handlingFeeCny: number | null;
  telegraphFeeCny: number | null;
  totalCostCny: number | null;
  effectiveRate: number | null;
  differenceFromBestCny: number | null;
}
