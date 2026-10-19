import { eq, inArray } from "drizzle-orm";
import { db, wealthHoldingsTable, wealthSettingsTable } from "@workspace/db";
import { IntegrationConfigurationError } from "./email-recovery";
import type { Analysis, TaxSettings } from "./tax-harvest";

export const ASSET_TYPES = ["stock", "etf", "crypto", "other"] as const;
type AssetType = (typeof ASSET_TYPES)[number];

export type NewLot = {
  symbol: string;
  assetType: AssetType;
  account: string;
  quantity: number;
  costBasisPerUnit: number;
  acquiredOn: string;
  currentPrice: number | null;
};

export function normalizeDate(raw: string): string | null {
  const value = raw.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    iso = value;
  } else {
    const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // MM/DD/YYYY
    if (us) iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  if (iso > new Date().toISOString().slice(0, 10)) return null; // no future purchases
  return iso;
}

const toNumber = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, "")));

export function validateLot(input: Record<string, unknown>): { lot?: NewLot; error?: string } {
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return { error: "Symbol must be 1-15 letters or numbers." };

  const quantity = toNumber(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: `${symbol}: quantity must be greater than 0.` };

  const costBasisPerUnit = toNumber(input.costBasisPerUnit);
  if (!Number.isFinite(costBasisPerUnit) || costBasisPerUnit < 0) return { error: `${symbol}: cost basis must be 0 or more.` };

  const acquiredOn = normalizeDate(String(input.acquiredOn ?? ""));
  if (!acquiredOn) return { error: `${symbol}: purchase date must be a past date like 2025-03-14.` };

  let currentPrice: number | null = null;
  if (input.currentPrice !== undefined && input.currentPrice !== null && String(input.currentPrice).trim() !== "") {
    currentPrice = toNumber(input.currentPrice);
    if (!Number.isFinite(currentPrice) || currentPrice < 0) return { error: `${symbol}: current price must be 0 or more.` };
  }

  const rawType = String(input.assetType ?? "stock").trim().toLowerCase();
  const assetType = (ASSET_TYPES as readonly string[]).includes(rawType) ? (rawType as AssetType) : "stock";

  return {
    lot: { symbol, assetType, account: String(input.account ?? "").trim().slice(0, 60), quantity, costBasisPerUnit, acquiredOn, currentPrice },
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else { quoted = !quoted; }
      } else if (ch === "," && !quoted) {
        cells.push(current.trim()); current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

/** Maps a normalized header cell (e.g. "cost_basis_per_share") to a field key. */
function classifyHeader(h: string): string | null {
  if (/^(symbol|ticker)$/.test(h)) return "symbol";
  if (/^(quantity|qty|shares|units)$/.test(h)) return "quantity";
  if (/(per_share|per_unit|unit_cost|avg|average|price_paid)/.test(h) && /(cost|basis|paid)/.test(h)) return "perUnit";
  if (/^(cost_basis|total_cost|basis|total_cost_basis|cost_basis_total|cost)$/.test(h)) return "total";
  if (/(date|acquired|purchase)/.test(h)) return "date";
  if (/^(current_price|price|last_price|market_price)$/.test(h)) return "price";
  if (/^(asset_type|type)$/.test(h)) return "type";
  if (/^(account|broker)$/.test(h)) return "account";
  return null;
}

export function parseHoldingsCsv(text: string): { lots: NewLot[]; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const lots: NewLot[] = [];
  if (!rows.length) return { lots, errors: ["The CSV is empty."] };
  if (rows.length > 501) return { lots, errors: ["Import up to 500 rows at a time."] };

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const first = rows[0].map(normalize);
  const hasHeader = first.some((cell) => classifyHeader(cell) !== null);

  const index: Record<string, number> = {};
  if (hasHeader) {
    first.forEach((cell, position) => {
      const key = classifyHeader(cell);
      if (key && index[key] === undefined) index[key] = position;
    });
    const missing = ["symbol", "quantity", "date"].filter((k) => index[k] === undefined);
    if (index.perUnit === undefined && index.total === undefined) missing.push("cost basis");
    if (missing.length) return { lots, errors: [`Missing column(s): ${missing.join(", ")}.`] };
  } else {
    Object.assign(index, { symbol: 0, quantity: 1, perUnit: 2, date: 3, price: 4 });
  }

  rows.slice(hasHeader ? 1 : 0).forEach((cells, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const get = (k: string) => (index[k] === undefined ? "" : (cells[index[k]] ?? ""));
    const quantity = toNumber(get("quantity"));
    let costBasisPerUnit: number;
    if (index.perUnit !== undefined) costBasisPerUnit = toNumber(get("perUnit"));
    else costBasisPerUnit = quantity > 0 ? toNumber(get("total")) / quantity : NaN;

    const result = validateLot({
      symbol: get("symbol"), quantity, costBasisPerUnit,
      acquiredOn: get("date"), currentPrice: get("price"), assetType: get("type"), account: get("account"),
    });
    if (result.lot) lots.push(result.lot);
    else errors.push(`Row ${line}: ${result.error}`);
  });
  return { lots, errors };
}

export async function getSettings() {
  const [row] = await db.select().from(wealthSettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(wealthSettingsTable).values({}).returning();
  return created;
}

export function toTaxSettings(row: Awaited<ReturnType<typeof getSettings>>): TaxSettings {
  return {
    shortTermRate: row.shortTermRate,
    longTermRate: row.longTermRate,
    realizedShortGains: row.realizedShortGains,
    realizedLongGains: row.realizedLongGains,
  };
}

/** Optional live prices for stocks/ETFs via Finnhub's free API. */
export async function refreshPrices(): Promise<{ updated: number; failed: string[] }> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    throw new IntegrationConfigurationError("Add FINNHUB_API_KEY (free at finnhub.io) to refresh prices automatically, or type prices in by hand.");
  }
  const lots = await db.select().from(wealthHoldingsTable).where(inArray(wealthHoldingsTable.assetType, ["stock", "etf"]));
  const symbols = [...new Set(lots.map((l) => l.symbol))];
  let updated = 0;
  const failed: string[] = [];
  for (const symbol of symbols) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { c?: number };
      if (!data.c || data.c <= 0) throw new Error("no price");
      await db.update(wealthHoldingsTable)
        .set({ currentPrice: data.c, priceUpdatedAt: new Date() })
        .where(eq(wealthHoldingsTable.symbol, symbol));
      updated += lots.filter((l) => l.symbol === symbol).length;
    } catch {
      failed.push(symbol);
    }
  }
  return { updated, failed };
}

/** The AI only words the numbers the engine already computed. */
export async function generateDigest(analysis: Analysis): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new IntegrationConfigurationError("Add GROQ_API_KEY to enable the digest.");

  const facts = {
    daysToYearEnd: analysis.daysToYearEnd,
    estimatedTaxSavings: analysis.estimatedTaxSavings,
    harvestableLossShortTerm: analysis.harvestableLossShort,
    harvestableLossLongTerm: analysis.harvestableLossLong,
    carryforwardAfter: analysis.carryforwardAfter,
    topOpportunities: analysis.opportunities.slice(0, 3).map((o) => ({ symbol: o.symbol, loss: o.loss, term: o.term, estTaxValue: o.estTaxValue })),
    washSaleCautions: analysis.cautions.map((c) => c.symbol),
    lotsMissingPrice: analysis.lotsMissingPrice,
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen/qwen3.8-27b",
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You turn pre-computed tax-loss harvesting numbers into a short plain-English alert. Use ONLY the numbers provided and never invent figures. Do not give investment advice or tell the user to buy or sell; describe what Arvo flagged. Return only JSON." },
        { role: "user", content: `Facts (USD): ${JSON.stringify(facts)}\n\nWrite 3 to 5 short sentences: the estimated savings and what drives it, the year-end deadline in days, any wash-sale cautions, and any holdings missing prices. Finish with exactly: "Informational only, not tax advice. Confirm with your CPA before acting." Return JSON with one property "digest".` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Groq returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty digest.");
  const parsed = JSON.parse(content) as { digest?: unknown };
  if (typeof parsed.digest !== "string") throw new Error("The digest was missing.");
  return parsed.digest;
}
