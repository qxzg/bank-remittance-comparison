import type { RateQuote } from "../shared/types";
import {
  getBankId,
  normalizeBankName,
  normalizeWhitespace,
} from "../shared/banks";

export const NATIONAL_RATES_URL =
  "https://www.kylc.com/bank/rmbfx.html?ccy=usd";
export const BEIJING_RATES_URL =
  "https://www.kylc.com/huilv/bank/perccy/usd/110100.html";

function parseNumber(value: string): number | null {
  const clean = normalizeWhitespace(value).replace(/,/g, "");
  if (!clean || clean === "--") return null;
  const number = Number.parseFloat(clean);
  return Number.isFinite(number) ? number : null;
}

async function readRows(
  response: Response,
  tableId: string,
  lastCellIndex: number,
): Promise<string[][]> {
  const rows: string[][] = [];
  let insideTable = false;
  let tableComplete = false;
  let currentCells: string[] | null = null;
  let cellIndex = -1;
  const transformed = new HTMLRewriter()
    .on("table", {
      element(table) {
        if (table.getAttribute("id") !== tableId) return;
        insideTable = true;
        table.onEndTag(() => {
          insideTable = false;
          tableComplete = true;
          currentCells = null;
        });
      },
    })
    .on("tr", {
      element() {
        if (!insideTable) return;
        currentCells = [];
        cellIndex = -1;
      },
    })
    .on("td", {
      element() {
        if (!insideTable || !currentCells) return;
        cellIndex += 1;
        currentCells[cellIndex] = "";
      },
      text(text) {
        if (currentCells && cellIndex >= 0) {
          currentCells[cellIndex] += text.text;
          if (cellIndex === lastCellIndex && text.lastInTextNode) {
            rows.push(currentCells.map(normalizeWhitespace));
            currentCells = null;
          }
        }
      },
    })
    .transform(response);

  const reader = transformed.body?.getReader();
  if (!reader) return [];
  try {
    while (!tableComplete) {
      const { done } = await reader.read();
      if (done) break;
    }
    if (tableComplete) await reader.cancel();
  } finally {
    reader.releaseLock();
  }
  return rows;
}

async function parseRatesTable(
  response: Response,
  tableId: string,
  source: RateQuote["source"],
  sourceUrl: string,
  columns: { sell: number; published: number },
): Promise<RateQuote[]> {
  const rates: RateQuote[] = [];

  const lastCellIndex = Math.max(columns.sell, columns.published);
  for (const cells of await readRows(response, tableId, lastCellIndex)) {
    const bankName = normalizeBankName(cells[0] ?? "");
    const sellRate = parseNumber(cells[columns.sell] ?? "");
    if (!bankName || sellRate === null) continue;

    rates.push({
      bankId: getBankId(bankName),
      bankName,
      sellRateCnyPerUsd: sellRate,
      publishedAtText: normalizeWhitespace(cells[columns.published] ?? ""),
      source,
      sourceUrl,
    });
  }

  return rates;
}

export function parseNationalRatesResponse(
  response: Response,
): Promise<RateQuote[]> {
  return parseRatesTable(
    response,
    "bank_rate_usd",
    "national",
    NATIONAL_RATES_URL,
    { sell: 3, published: 5 },
  );
}

export async function parseBeijingBankRateResponse(
  response: Response,
): Promise<RateQuote | null> {
  const rates = await parseRatesTable(
    response,
    "bank_rate",
    "beijing",
    BEIJING_RATES_URL,
    { sell: 4, published: 6 },
  );
  return rates.find((rate) => rate.bankName === "北京银行") ?? null;
}
