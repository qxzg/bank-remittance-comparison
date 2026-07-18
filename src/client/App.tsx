import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  Check,
  Clock3,
  ExternalLink,
  Info,
  Landmark,
  LoaderCircle,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateComparisons,
  chooseDefaultTier,
  groupTiersByBank,
} from "../shared/calculation";
import type {
  ComparisonResult,
  FeeSnapshot,
  FeeTier,
  RatesResponse,
} from "../shared/types";

const DEFAULT_AMOUNT = "10000";
const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 20_000, 50_000, 100_000] as const;
const REFRESH_INTERVAL_MS = 60_000;
const STORAGE_KEY = "bank-remittance-selected-tiers-v1";

const cnyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCny(value: number | null): string {
  return value === null ? "待补充" : cnyFormatter.format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function feeRuleLabel(tier: FeeTier | null): string {
  if (!tier) return "手续费资料待补充";
  if (tier.feeRule.kind === "free") return "手续费免费";
  if (tier.feeRule.kind === "review") return tier.feeRule.reason;
  return `${(tier.feeRule.percent * 100).toFixed(2)}% · ${tier.feeRule.minimumCny}–${tier.feeRule.maximumCny} 元`;
}

function loadSavedTiers(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

interface SummaryCardProps {
  icon: React.ReactNode;
  eyebrow: string;
  value: string;
  note: string;
  accent?: boolean;
}

function SummaryCard({ icon, eyebrow, value, note, accent }: SummaryCardProps) {
  return (
    <article
      className={`relative overflow-hidden rounded-3xl border p-5 shadow-[0_18px_55px_rgba(5,20,34,0.08)] transition-transform hover:-translate-y-0.5 ${
        accent
          ? "border-cyan-200/80 bg-gradient-to-br from-cyan-50 to-white"
          : "border-slate-200/80 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
            {eyebrow}
          </p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
            {value}
          </p>
        </div>
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
            accent ? "bg-cyan-500 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">{note}</p>
    </article>
  );
}

interface TierSelectProps {
  bankId: string;
  currentTier: FeeTier | null;
  tiers: FeeTier[];
  onChange: (bankId: string, tierId: string) => void;
}

function TierSelect({ bankId, currentTier, tiers, onChange }: TierSelectProps) {
  if (tiers.length === 0) {
    return <span className="text-sm text-amber-700">收费规则待补充</span>;
  }
  return (
    <div className="min-w-48">
      <select
        aria-label={`${bankId} 客户等级`}
        value={currentTier?.id ?? ""}
        onChange={(event) => onChange(bankId, event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
      >
        {tiers.map((tier) => (
          <option key={tier.id} value={tier.id}>
            {tier.label}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs leading-5 text-slate-500">
        {feeRuleLabel(currentTier)}
      </p>
    </div>
  );
}

interface DetailNoteProps {
  comparison: ComparisonResult;
}

function DetailNote({ comparison }: DetailNoteProps) {
  const tier = comparison.tier;
  return (
    <details className="group mt-3 text-left">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-cyan-700">
        <Info className="size-3.5" />
        查看计费依据
      </summary>
      <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <p>手续费：{tier?.rawFeeText || "资料待补充"}</p>
        <p>电报费：{tier?.rawTelegraphText || "资料待补充"}</p>
        {tier?.officialUrl && (
          <a
            href={tier.officialUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-semibold text-cyan-700 hover:text-cyan-800"
          >
            官方收费文件 <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </details>
  );
}

export function App() {
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [fees, setFees] = useState<FeeSnapshot | null>(null);
  const [selectedTiers, setSelectedTiers] = useState<Record<string, string>>(
    loadSavedTiers,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRates = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/rates${force ? "?refresh=1" : ""}`);
      const data = (await response.json()) as RatesResponse | { error: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "牌价更新失败");
      }
      setRates(data);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "牌价更新失败",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [rateResponse, feeResponse] = await Promise.all([
          fetch("/api/rates"),
          fetch("/api/fees", { cache: "no-store" }),
        ]);
        const rateData = (await rateResponse.json()) as
          | RatesResponse
          | { error: string };
        const feeData = (await feeResponse.json()) as
          | FeeSnapshot
          | { error: string };
        if (!rateResponse.ok || "error" in rateData) {
          throw new Error("error" in rateData ? rateData.error : "牌价加载失败");
        }
        if (!feeResponse.ok || "error" in feeData) {
          throw new Error(
            "error" in feeData ? feeData.error : "手续费加载失败",
          );
        }
        if (active) {
          setRates(rateData);
          setFees(feeData);
          setError(null);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error ? requestError.message : "数据加载失败",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(() => void fetchRates(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [fetchRates]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedTiers));
  }, [selectedTiers]);

  const amountUsd = Number(amountText);
  const amountValid = Number.isFinite(amountUsd) && amountUsd > 0;

  const tiersByBank = useMemo(
    () => groupTiersByBank(fees?.tiers ?? []),
    [fees],
  );

  const comparisons = useMemo(
    () =>
      calculateComparisons(
        amountUsd,
        rates?.rates ?? [],
        fees?.tiers ?? [],
        selectedTiers,
      ),
    [amountUsd, rates, fees, selectedTiers],
  );

  const best = comparisons.find((item) => item.totalCostCny !== null) ?? null;
  const complete = comparisons.filter((item) => item.totalCostCny !== null);
  const highest = complete.at(-1) ?? null;
  const savings =
    best?.totalCostCny !== null && highest?.totalCostCny !== null
      ? (highest?.totalCostCny ?? 0) - (best?.totalCostCny ?? 0)
      : 0;

  const handleTierChange = (bankId: string, tierId: string) => {
    setSelectedTiers((current) => ({ ...current, [bankId]: tierId }));
  };

  const displayedTier = (comparison: ComparisonResult): FeeTier | null => {
    const bankTiers = tiersByBank.get(comparison.bankId) ?? [];
    return (
      bankTiers.find((tier) => tier.id === selectedTiers[comparison.bankId]) ??
      chooseDefaultTier(bankTiers)
    );
  };

  return (
    <div className="min-h-screen bg-[#f4f7f9] text-slate-900">
      <header className="hero-grid relative overflow-hidden bg-[#071422] text-white">
        <div className="absolute top-[-12rem] right-[-8rem] size-[30rem] rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-[-14rem] left-[18%] size-[28rem] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1440px] px-5 pt-6 pb-32 sm:px-8 lg:px-10">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/20">
                <Landmark className="size-5" />
              </span>
              <div>
                <p className="font-bold tracking-tight">汇款智选</p>
                <p className="text-[11px] tracking-[0.18em] text-slate-400 uppercase">
                  Bank Cost Radar
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 sm:flex">
              <Radio className="size-3.5 text-emerald-400" />
              牌价每 60 秒更新
            </div>
          </nav>

          <div className="mt-16 grid items-end gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-200">
                <Sparkles className="size-3.5" />
                美元购汇 · 汇往美国
              </div>
              <h1 className="mt-6 max-w-3xl text-4xl leading-[1.08] font-bold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                看清每一笔汇款的
                <span className="block text-cyan-300">真实境内成本</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                汇率差、手续费和电报费统一折算，实时比较各家银行的人民币总支出。
              </p>
            </div>

            <div className="rounded-[2rem] border border-white/12 bg-white/[0.07] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-6">
              <label
                htmlFor="amount"
                className="text-xs font-semibold tracking-[0.15em] text-slate-300 uppercase"
              >
                计划汇出金额
              </label>
              <div className="mt-3 flex items-center rounded-2xl border border-white/15 bg-slate-950/40 px-4 focus-within:border-cyan-300/70 focus-within:ring-4 focus-within:ring-cyan-300/10">
                <span className="text-xl font-bold text-cyan-300">$</span>
                <input
                  id="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-3 py-4 text-3xl font-bold tracking-tight text-white outline-none sm:text-4xl"
                />
                <span className="font-semibold text-slate-400">USD</span>
              </div>
              <div className="mt-4">
                <div
                  className="grid w-full grid-cols-6 gap-1.5 sm:min-w-0 sm:flex-1"
                  aria-label="常用金额"
                >
                  {QUICK_AMOUNTS.map((amount) => {
                    const selected = amountValid && amountUsd === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        aria-label={`快速选择 ${amount} 美元`}
                        aria-pressed={selected}
                        onClick={() => setAmountText(String(amount))}
                        className={`min-w-0 whitespace-nowrap rounded-md border px-1.5 py-1 text-[10px] font-bold tabular-nums transition ${
                          selected
                            ? "border-cyan-300/70 bg-cyan-300/20 text-cyan-200 shadow-sm shadow-cyan-400/10"
                            : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100"
                        }`}
                      >
                        ${amount / 1_000}k
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-20 max-w-[1440px] px-5 pb-16 sm:px-8 lg:px-10">
        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">数据更新提示</p>
              <p className="mt-1 text-amber-800">{error}</p>
            </div>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={<ShieldCheck className="size-5" />}
            eyebrow="当前最优"
            value={best?.bankName ?? "数据加载中"}
            note={best ? `${best.tier?.label ?? "收费规则待补充"} · 排名第 1` : "正在汇总银行报价"}
            accent
          />
          <SummaryCard
            icon={<BadgeDollarSign className="size-5" />}
            eyebrow="人民币总支出"
            value={formatCny(best?.totalCostCny ?? null)}
            note="购汇成本、手续费与电报费合计"
          />
          <SummaryCard
            icon={<ArrowDownRight className="size-5" />}
            eyebrow="实际综合汇率"
            value={best?.effectiveRate?.toFixed(4) ?? "—"}
            note="每汇出 1 美元对应的人民币成本"
          />
          <SummaryCard
            icon={<Banknote className="size-5" />}
            eyebrow="方案价差"
            value={cnyFormatter.format(Math.max(0, savings))}
            note={`已计算 ${complete.length} 家银行的境内成本`}
          />
        </section>

        <section className="mt-7 overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_20px_65px_rgba(5,20,34,0.08)]">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-slate-950">
                  银行成本排名
                </h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {comparisons.length} 家
                </span>
              </div>
              <p className="mt-1.5 text-sm text-slate-500">
                按预计人民币总支出从低到高排列
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                抓取于 {rates ? formatDate(rates.fetchedAt) : "加载中"}
              </span>
              {rates?.cached && (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700">
                  30 秒缓存
                </span>
              )}
              {rates?.stale && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                  最近成功数据
                </span>
              )}
              <button
                type="button"
                aria-label="刷新牌价"
                onClick={() => void fetchRates(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-full bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700 transition hover:bg-cyan-100 hover:text-cyan-800 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                刷新牌价
              </button>
            </div>
          </div>

          {loading ? (
            <div className="grid place-items-center px-6 py-24 text-slate-500">
              <LoaderCircle className="size-8 animate-spin text-cyan-500" />
              <p className="mt-3 text-sm font-medium">正在获取实时牌价</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1160px] border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-slate-50/95 text-[11px] font-bold tracking-[0.1em] text-slate-500 uppercase backdrop-blur">
                    <tr>
                      <th className="px-6 py-4">排名 / 银行</th>
                      <th className="px-4 py-4">客户等级</th>
                      <th className="px-4 py-4 text-right">现汇卖出价</th>
                      <th className="px-4 py-4 text-right">购汇成本</th>
                      <th className="px-4 py-4 text-right">手续费</th>
                      <th className="px-4 py-4 text-right">电报费</th>
                      <th className="px-4 py-4 text-right">总成本</th>
                      <th className="px-6 py-4 text-right">较最优</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {comparisons.map((comparison, index) => {
                      const bankTiers = tiersByBank.get(comparison.bankId) ?? [];
                      const currentTier = displayedTier(comparison);
                      const isBest = comparison.totalCostCny !== null && index === 0;
                      return (
                        <tr
                          key={comparison.bankId}
                          className={`align-top transition hover:bg-slate-50/80 ${isBest ? "bg-cyan-50/45" : ""}`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-start gap-3">
                              <span
                                className={`grid size-8 shrink-0 place-items-center rounded-xl text-sm font-bold ${
                                  isBest
                                    ? "bg-cyan-500 text-white"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-bold text-slate-950">
                                    {comparison.bankName}
                                  </p>
                                  {isBest && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-800">
                                      <Check className="size-3" /> 最优
                                    </span>
                                  )}
                                </div>
                                <DetailNote comparison={{ ...comparison, tier: currentTier }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <TierSelect
                              bankId={comparison.bankId}
                              currentTier={currentTier}
                              tiers={bankTiers}
                              onChange={handleTierChange}
                            />
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="font-mono text-sm font-semibold text-slate-800">
                              {comparison.rate.sellRateCnyPerUsd.toFixed(6)}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              牌价 {comparison.rate.publishedAtText}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatCny(comparison.exchangeCostCny)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatCny(comparison.handlingFeeCny)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatCny(comparison.telegraphFeeCny)}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="font-bold text-slate-950">
                              {formatCny(comparison.totalCostCny)}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              {comparison.effectiveRate?.toFixed(4) ?? "—"} CNY/USD
                            </p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {comparison.differenceFromBestCny === 0 ? (
                              <span className="font-bold text-emerald-600">基准</span>
                            ) : comparison.differenceFromBestCny !== null ? (
                              <span className="inline-flex items-center justify-end gap-1 font-semibold text-rose-600">
                                <ArrowUpRight className="size-4" />
                                {cnyFormatter.format(comparison.differenceFromBestCny)}
                              </span>
                            ) : (
                              <span className="text-sm text-amber-700">待补充</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 lg:hidden">
                {comparisons.map((comparison, index) => {
                  const bankTiers = tiersByBank.get(comparison.bankId) ?? [];
                  const currentTier = displayedTier(comparison);
                  const isBest = comparison.totalCostCny !== null && index === 0;
                  return (
                    <article
                      key={comparison.bankId}
                      className={`p-5 sm:p-6 ${isBest ? "bg-cyan-50/50" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`grid size-9 place-items-center rounded-xl text-sm font-bold ${
                              isBest
                                ? "bg-cyan-500 text-white"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {index + 1}
                          </span>
                          <div>
                            <p className="font-bold text-slate-950">
                              {comparison.bankName}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {comparison.rate.publishedAtText}
                            </p>
                          </div>
                        </div>
                        {isBest && (
                          <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[10px] font-bold text-cyan-800">
                            当前最优
                          </span>
                        )}
                      </div>

                      <div className="mt-4">
                        <TierSelect
                          bankId={comparison.bankId}
                          currentTier={currentTier}
                          tiers={bankTiers}
                          onChange={handleTierChange}
                        />
                      </div>

                      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                        <div>
                          <dt className="text-xs text-slate-400">现汇卖出价</dt>
                          <dd className="mt-1 font-mono font-semibold">
                            {comparison.rate.sellRateCnyPerUsd.toFixed(6)}
                          </dd>
                        </div>
                        <div className="text-right">
                          <dt className="text-xs text-slate-400">购汇成本</dt>
                          <dd className="mt-1 font-semibold">
                            {formatCny(comparison.exchangeCostCny)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-400">手续费 + 电报费</dt>
                          <dd className="mt-1 font-semibold">
                            {comparison.handlingFeeCny !== null &&
                            comparison.telegraphFeeCny !== null
                              ? cnyFormatter.format(
                                  comparison.handlingFeeCny +
                                    comparison.telegraphFeeCny,
                                )
                              : "待补充"}
                          </dd>
                        </div>
                        <div className="text-right">
                          <dt className="text-xs text-slate-400">预计总成本</dt>
                          <dd className="mt-1 text-lg font-bold text-slate-950">
                            {formatCny(comparison.totalCostCny)}
                          </dd>
                        </div>
                      </dl>
                      <DetailNote comparison={{ ...comparison, tier: currentTier }} />
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="mt-7">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan-600" />
              <div>
                <p className="font-bold text-slate-900">计算范围说明</p>
                <p className="mt-1">
                  排名使用现汇卖出价、境内汇款手续费和美国方向电报费。中转行、收款行及全额到账服务费用请以银行实际办理结果为准。
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-5 py-6 text-center text-xs text-slate-400">
        第三方数据仅供成本比较，银行柜面及客户端显示价格作为最终交易依据。
      </footer>
    </div>
  );
}
