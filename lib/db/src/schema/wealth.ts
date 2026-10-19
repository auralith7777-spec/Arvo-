import {
  date,
  doublePrecision,
  index,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** One row per tax lot (a single purchase of a single asset). */
export const wealthHoldingsTable = pgTable(
  "wealth_holdings",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    assetType: text("asset_type").notNull().default("stock"),
    account: text("account").notNull().default(""),
    quantity: doublePrecision("quantity").notNull(),
    costBasisPerUnit: doublePrecision("cost_basis_per_unit").notNull(),
    acquiredOn: date("acquired_on", { mode: "string" }).notNull(),
    currentPrice: doublePrecision("current_price"),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("wealth_holdings_symbol_idx").on(table.symbol)],
);

/** Single-row settings table (Arvo is single-admin for now). */
export const wealthSettingsTable = pgTable("wealth_settings", {
  id: serial("id").primaryKey(),
  shortTermRate: doublePrecision("short_term_rate").notNull().default(0.32),
  longTermRate: doublePrecision("long_term_rate").notNull().default(0.15),
  realizedShortGains: doublePrecision("realized_short_gains").notNull().default(0),
  realizedLongGains: doublePrecision("realized_long_gains").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WealthHolding = typeof wealthHoldingsTable.$inferSelect;
export type WealthSettings = typeof wealthSettingsTable.$inferSelect;
