import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const arvoInvoicesTable = pgTable(
  "arvo_invoices",
  {
    id: serial("id").primaryKey(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("active"),
    sequenceDay: integer("sequence_day").notNull().default(0),
    lastActionDay: integer("last_action_day").notNull().default(0),
    lastActionTaken: text("last_action_taken"),
    lastActionAt: timestamp("last_action_at", { withTimezone: true }),
    tone: text("tone").notNull().default("friendly"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("arvo_invoices_status_due_date_idx").on(table.status, table.dueDate),
    index("arvo_invoices_stripe_invoice_id_idx").on(table.stripeInvoiceId),
  ],
);

export const arvoSequenceActionsTable = pgTable(
  "arvo_sequence_actions",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => arvoInvoicesTable.id, { onDelete: "cascade" }),
    actionDay: integer("action_day").notNull(),
    actionType: text("action_type").notNull(),
    result: text("result").notNull(),
    summary: text("summary").notNull(),
    subject: text("subject"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("arvo_sequence_actions_created_at_idx").on(table.createdAt),
    index("arvo_sequence_actions_invoice_id_idx").on(table.invoiceId),
  ],
);