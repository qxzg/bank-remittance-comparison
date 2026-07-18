import * as cheerio from "cheerio";
import type { FeeRule, FeeTier } from "../src/shared/types";
import {
  getBankId,
  makeTierId,
  normalizeBankName,
  normalizeWhitespace,
} from "../src/shared/banks";

export const FEES_URL = "https://www.kylc.com/bank/fees/tt.html";

export function parseFeeRule(rawText: string): FeeRule {
  const text = normalizeWhitespace(rawText);
  if (text.includes("免费")) {
    return { kind: "free", percent: 0, minimumCny: 0, maximumCny: 0 };
  }

  const percentMatch = text.match(/汇款金额的\s*([\d.]+)\s*%/);
  const minimumMatch = text.match(/最低\s*([\d.]+)\s*元/);
  const maximumMatch = text.match(/最高\s*([\d.]+)\s*元/);

  if (percentMatch && minimumMatch && maximumMatch) {
    return {
      kind: "percentage",
      percent: Number(percentMatch[1]) / 100,
      minimumCny: Number(minimumMatch[1]),
      maximumCny: Number(maximumMatch[1]),
    };
  }

  return {
    kind: "review",
    reason: text ? "收费文本需要人工确认" : "收费文本为空",
  };
}

export function parseUsTelegraphFee(rawText: string): number | null {
  const text = normalizeWhitespace(rawText);
  if (text.includes("免费")) return 0;

  const overseasMatch = text.match(/(?:其余|海外)\s*[:：]?\s*([\d.]+)\s*元/);
  if (overseasMatch) return Number(overseasMatch[1]);

  const values = [...text.matchAll(/([\d.]+)\s*元/g)].map((match) =>
    Number(match[1]),
  );
  return values.length === 1 ? values[0] : null;
}

function readRemarks(onclick: string | undefined): string | null {
  if (!onclick) return null;
  const match = onclick.match(/^show_info\('[\s\S]*?',\s*'([\s\S]*)'\);?$/);
  if (!match) return null;
  const html = match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const $ = cheerio.load(`<div>${html}</div>`);
  $("br").replaceWith("\n");
  return $("div").text().replace(/\n{3,}/g, "\n\n").trim() || null;
}

function absoluteUrl(value: string | undefined): string | null {
  if (!value || value.startsWith("javascript:")) return null;
  try {
    return new URL(value, "https://www.kylc.com").toString();
  } catch {
    return null;
  }
}

export function parseFeesHtml(html: string): FeeTier[] {
  const $ = cheerio.load(html);
  const tiers: FeeTier[] = [];
  let currentBank = "";
  let currentOfficialUrl: string | null = null;
  let bankTierIndex = 0;

  $("#table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const bankCellText = normalizeWhitespace($(row).find("td.bank_name").text());
    if (bankCellText) {
      currentBank = normalizeBankName(bankCellText);
      currentOfficialUrl = null;
      bankTierIndex = 0;
    }
    if (!currentBank) return;

    const label = normalizeWhitespace(cells.eq(1).text());
    const rawFeeText = normalizeWhitespace(cells.eq(2).text());
    const rawTelegraphText = normalizeWhitespace(cells.eq(3).text());
    const officialUrl = absoluteUrl(cells.eq(5).find("a").attr("href"));
    if (officialUrl) currentOfficialUrl = officialUrl;
    const remarks = readRemarks(cells.eq(6).find("a").attr("onclick"));
    if (!label) return;

    const bankId = getBankId(currentBank);
    tiers.push({
      id: makeTierId(bankId, bankTierIndex, label),
      bankId,
      bankName: currentBank,
      label,
      feeRule: parseFeeRule(rawFeeText),
      telegraphFeeUsCny: parseUsTelegraphFee(rawTelegraphText),
      rawFeeText,
      rawTelegraphText,
      officialUrl: officialUrl ?? currentOfficialUrl,
      remarks,
    });
    bankTierIndex += 1;
  });

  return tiers;
}
