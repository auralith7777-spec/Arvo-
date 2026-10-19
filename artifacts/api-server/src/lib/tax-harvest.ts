/**
 * Tax-loss harvesting engine (US federal rules, estimates only).
 * Pure functions with no database access so the math is easy to test.
 */

export type Lot = {
  id: number;
  symbol: string;
  assetType: string;
  account: string;
  quantity: number;
  costBasisPerUnit: number;
  acquiredOn: string; // YYYY-MM-DD
  currentPrice: number | null;
};

export type TaxSettings = {
  shortTermRate: number; // e.g. 0.32
  longTermRate: number; // e.g. 0.15
  realizedShortGains: number; // year-to-date realized, can be negative
  realizedLongGains: number;
};

export type Opportunity = {
  lotId: number;
  symbol: string;
  assetType: string;
  account: string;
  quantity: number;
  costBasisPerUnit: number;
  currentPrice: number;
  loss: number; // positive number = size of the loss
  term: "short" | "long";
  heldDays: number;
  estTaxValue: number;
  washSaleRisk: boolean;
  note: string | null;
};

export type Analysis = {
  asOf: string;
  daysToYearEnd: number;
  totalValue: number;
  totalUnrealizedGain: number;
  harvestableLossShort: number;
  harvestableLossLong: number;
  estimatedTaxSavings: number;
  carryforwardAfter: number;
  opportunities: Opportunity[];
  cautions: Opportunity[]; // losses held back because of a wash-sale risk
  lotsMissingPrice: number;
};

const ORDINARY_LOSS_LIMIT = 3000;
const WASH_SALE_WINDOW_DAYS = 30;

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  return Math.floor((to - from) / 86_400_000);
}

/** Tax owed on net short/long results, after IRS-style netting. */
export function netTax(
  netShort: number,
  netLong: number,
  shortRate: number,
  longRate: number,
): { tax: number; deduction: number; carryforward: number } {
  const total = netShort + netLong;
  if (netShort >= 0 && netLong >= 0) {
    return { tax: netShort * shortRate + netLong * longRate, deduction: 0, carryforward: 0 };
  }
  if (total >= 0) {
    // One side is a loss that is fully absorbed by the other side's gain.
    return { tax: total * (netShort < 0 ? longRate : shortRate), deduction: 0, carryforward: 0 };
  }
  const loss = -total;
  const deduction = Math.min(loss, ORDINARY_LOSS_LIMIT);
  return { tax: 0, deduction, carryforward: loss - deduction };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function analyze(lots: Lot[], settings: TaxSettings, now = new Date()): Analysis {
  const today = now.toISOString().slice(0, 10);
  const yearEnd = `${today.slice(0, 4)}-12-31`;

  let totalValue = 0;
  let totalUnrealizedGain = 0;
  let lotsMissingPrice = 0;

  const lossLots: Opportunity[] = [];
  for (const lot of lots) {
    if (lot.currentPrice === null) {
      lotsMissingPrice += 1;
      continue;
    }
    const value = lot.currentPrice * lot.quantity;
    const gain = (lot.currentPrice - lot.costBasisPerUnit) * lot.quantity;
    totalValue += value;
    totalUnrealizedGain += gain;
    if (gain >= 0) continue;

    const heldDays = daysBetween(lot.acquiredOn, today);
    const term = heldDays > 365 ? "long" : "short";
    const loss = -gain;

    const sameSymbolRecentBuy = lots.some(
      (other) =>
        other.id !== lot.id &&
        other.symbol.toUpperCase() === lot.symbol.toUpperCase() &&
        daysBetween(other.acquiredOn, today) >= 0 &&
        daysBetween(other.acquiredOn, today) <= WASH_SALE_WINDOW_DAYS,
    );

    let note: string | null = null;
    if (sameSymbolRecentBuy) {
      note = "You bought this symbol within the last 30 days. Selling this lot at a loss could trigger a wash sale, which disallows the loss.";
    } else if (lot.assetType === "crypto") {
      note = "Wash-sale treatment of crypto differs from stocks and may change. Confirm with a tax professional before acting.";
    }

    lossLots.push({
      lotId: lot.id,
      symbol: lot.symbol.toUpperCase(),
      assetType: lot.assetType,
      account: lot.account,
      quantity: lot.quantity,
      costBasisPerUnit: lot.costBasisPerUnit,
      currentPrice: lot.currentPrice,
      loss: round2(loss),
      term,
      heldDays,
      estTaxValue: round2(loss * (term === "long" ? settings.longTermRate : settings.shortTermRate)),
      washSaleRisk: sameSymbolRecentBuy,
      note,
    });
  }

  const harvestable = lossLots.filter((l) => !l.washSaleRisk);
  const cautions = lossLots.filter((l) => l.washSaleRisk);
  const byValue = (a: Opportunity, b: Opportunity) => b.estTaxValue - a.estTaxValue;
  harvestable.sort(byValue);
  cautions.sort(byValue);

  const lossShort = harvestable.filter((l) => l.term === "short").reduce((s, l) => s + l.loss, 0);
  const lossLong = harvestable.filter((l) => l.term === "long").reduce((s, l) => s + l.loss, 0);

  const before = netTax(settings.realizedShortGains, settings.realizedLongGains, settings.shortTermRate, settings.longTermRate);
  const after = netTax(
    settings.realizedShortGains - lossShort,
    settings.realizedLongGains - lossLong,
    settings.shortTermRate,
    settings.longTermRate,
  );
  // Up to $3,000 of leftover loss offsets ordinary income; the short-term
  // rate stands in for the user's ordinary income rate.
  const benefit = (r: { tax: number; deduction: number }) => r.tax - r.deduction * settings.shortTermRate;
  const savings = Math.max(0, benefit(before) - benefit(after));

  return {
    asOf: today,
    daysToYearEnd: Math.max(0, daysBetween(today, yearEnd)),
    totalValue: round2(totalValue),
    totalUnrealizedGain: round2(totalUnrealizedGain),
    harvestableLossShort: round2(lossShort),
    harvestableLossLong: round2(lossLong),
    estimatedTaxSavings: round2(savings),
    carryforwardAfter: round2(after.carryforward),
    opportunities: harvestable,
    cautions,
    lotsMissingPrice,
  };
}
