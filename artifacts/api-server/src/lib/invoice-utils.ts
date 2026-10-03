import { eq } from "drizzle-orm";
import type { Invoice } from "@workspace/api-zod";
import { db, arvoInvoicesTable } from "@workspace/db";

export function toInvoiceDto(
  row: typeof arvoInvoicesTable.$inferSelect,
): Invoice {
  return {
    id: row.id,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    invoiceNumber: row.invoiceNumber,
    stripeInvoiceId: row.stripeInvoiceId,
    amountCents: row.amountCents,
    currency: row.currency,
    dueDate: row.dueDate,
    status: row.status as Invoice["status"],
    sequenceDay: row.sequenceDay,
    lastActionTaken: row.lastActionTaken,
    lastActionAt: row.lastActionAt?.toISOString() ?? null,
    tone: row.tone as Invoice["tone"],
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

export async function markInvoicePaid(
  invoiceId: number,
  source: "dashboard" | "stripe",
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(arvoInvoicesTable)
      .where(eq(arvoInvoicesTable.id, invoiceId))
      .for("update")
      .limit(1);

    if (!existing) return null;
    if (existing.status === "paid") return existing;

    const now = new Date();
    const lastActionTaken =
      source === "stripe"
        ? "Sequence stopped — payment received via Stripe"
        : "Sequence stopped — marked paid from dashboard";
    const [updated] = await tx
      .update(arvoInvoicesTable)
      .set({
        status: "paid",
        paidAt: now,
        lastActionTaken,
        lastActionAt: now,
      })
      .where(eq(arvoInvoicesTable.id, invoiceId))
      .returning();

    return updated ?? null;
  });
}