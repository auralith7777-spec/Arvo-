import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, wealthHoldingsTable, wealthSettingsTable } from "@workspace/db";
import { IntegrationConfigurationError } from "../lib/email-recovery";
import { logger } from "../lib/logger";
import { analyze } from "../lib/tax-harvest";
import { generateDigest, getSettings, parseHoldingsCsv, refreshPrices, toTaxSettings, validateLot } from "../lib/wealth";

const router: IRouter = Router();

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const parseId = (raw: unknown): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

router.get("/wealth/holdings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(wealthHoldingsTable).orderBy(wealthHoldingsTable.symbol, desc(wealthHoldingsTable.acquiredOn));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), priceUpdatedAt: r.priceUpdatedAt?.toISOString() ?? null })));
});

router.post("/wealth/holdings", async (req, res): Promise<void> => {
  const { lot, error } = validateLot(req.body ?? {});
  if (!lot) { res.status(400).json({ error }); return; }
  const [created] = await db.insert(wealthHoldingsTable).values({ ...lot, priceUpdatedAt: lot.currentPrice === null ? null : new Date() }).returning();
  res.status(201).json(created);
});

router.post("/wealth/holdings/import", async (req, res): Promise<void> => {
  const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!csv.trim()) { res.status(400).json({ error: "Paste CSV text to import." }); return; }
  const { lots, errors } = parseHoldingsCsv(csv);
  if (lots.length) {
    await db.insert(wealthHoldingsTable).values(lots.map((l) => ({ ...l, priceUpdatedAt: l.currentPrice === null ? null : new Date() })));
  }
  res.json({ imported: lots.length, errors });
});

router.patch("/wealth/holdings/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id." }); return; }
  const raw = req.body?.currentPrice;
  const price = raw === null || raw === "" ? null : Number(raw);
  if (price !== null && (!Number.isFinite(price) || price < 0)) { res.status(400).json({ error: "Price must be 0 or more." }); return; }
  const [updated] = await db.update(wealthHoldingsTable)
    .set({ currentPrice: price, priceUpdatedAt: price === null ? null : new Date() })
    .where(eq(wealthHoldingsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Holding not found." }); return; }
  res.json(updated);
});

router.delete("/wealth/holdings/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id." }); return; }
  await db.delete(wealthHoldingsTable).where(eq(wealthHoldingsTable.id, id));
  res.json({ deleted: id });
});

router.post("/wealth/prices/refresh", async (_req, res): Promise<void> => {
  try {
    res.json(await refreshPrices());
  } catch (error) {
    res.status(error instanceof IntegrationConfigurationError ? 503 : 502).json({ error: message(error) });
  }
});

router.get("/wealth/settings", async (_req, res): Promise<void> => {
  const row = await getSettings();
  res.json(toTaxSettings(row));
});

router.put("/wealth/settings", async (req, res): Promise<void> => {
  const b = req.body ?? {};
  const shortTermRate = Number(b.shortTermRate);
  const longTermRate = Number(b.longTermRate);
  const realizedShortGains = Number(b.realizedShortGains);
  const realizedLongGains = Number(b.realizedLongGains);
  const rateOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 0.6;
  if (!rateOk(shortTermRate) || !rateOk(longTermRate)) { res.status(400).json({ error: "Tax rates must be between 0% and 60%." }); return; }
  if (!Number.isFinite(realizedShortGains) || !Number.isFinite(realizedLongGains)) { res.status(400).json({ error: "Realized gains must be numbers (use a minus sign for losses)." }); return; }
  const current = await getSettings();
  await db.update(wealthSettingsTable)
    .set({ shortTermRate, longTermRate, realizedShortGains, realizedLongGains, updatedAt: new Date() })
    .where(eq(wealthSettingsTable.id, current.id));
  res.json({ shortTermRate, longTermRate, realizedShortGains, realizedLongGains });
});

router.get("/wealth/analysis", async (_req, res): Promise<void> => {
  const [rows, settings] = await Promise.all([db.select().from(wealthHoldingsTable), getSettings()]);
  res.json(analyze(rows, toTaxSettings(settings)));
});

router.post("/wealth/digest", async (_req, res): Promise<void> => {
  try {
    const [rows, settings] = await Promise.all([db.select().from(wealthHoldingsTable), getSettings()]);
    res.json({ digest: await generateDigest(analyze(rows, toTaxSettings(settings))) });
  } catch (error) {
    logger.warn({ err: message(error) }, "Wealth digest failed");
    res.status(error instanceof IntegrationConfigurationError ? 503 : 502).json({ error: message(error) });
  }
});

export default router;
