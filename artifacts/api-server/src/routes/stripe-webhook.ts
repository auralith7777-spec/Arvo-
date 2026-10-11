import Stripe from "stripe";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, arvoInvoicesTable } from "@workspace/db";
import { markInvoicePaid } from "../lib/invoice-utils";
import { getSequenceDay, processInvoiceSequence } from "../lib/sequence";

// This client is only used for local webhook signature verification.
// It never makes Stripe API requests, so no Stripe API secret key is needed.
const stripe = new Stripe("sk_test_webhook_signature_verification_only");


const IMPORT_EVENTS = new Set([
  "invoice.finalized",
  "invoice.overdue",
  "invoice.payment_failed",
]);
const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);

type ImportOutcome = "imported" | "exists" | "skipped";

/**
 * Starts tracking a Stripe invoice that has a payment problem, so the
 * recovery sequence begins without anyone typing the invoice in.
 */
async function importStripeInvoice(
  invoice: Stripe.Invoice,
  eventType: string,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<ImportOutcome> {
  if (invoice.status === "paid" || invoice.status === "void" || invoice.status === "uncollectible") {
    return "skipped";
  }

  const [existing] = await db
    .select({ id: arvoInvoicesTable.id })
    .from(arvoInvoicesTable)
    .where(eq(arvoInvoicesTable.stripeInvoiceId, invoice.id))
    .limit(1);
  if (existing) return "exists";

  const email = invoice.customer_email?.trim().toLowerCase();
  if (!email) {
    log.warn({ stripeInvoiceId: invoice.id }, "Stripe invoice has no customer email; not imported");
    return "skipped";
  }

  const amountCents = invoice.amount_remaining ?? invoice.amount_due ?? 0;
  const currency = (invoice.currency ?? "usd").toUpperCase();
  if (amountCents <= 0 || !SUPPORTED_CURRENCIES.has(currency)) {
    log.warn({ stripeInvoiceId: invoice.id, amountCents, currency }, "Stripe invoice amount or currency unsupported; not imported");
    return "skipped";
  }

  const today = new Date().toISOString().slice(0, 10);
  let dueDate: string;
  if (invoice.due_date) {
    dueDate = new Date(invoice.due_date * 1000).toISOString().slice(0, 10);
  } else if (eventType === "invoice.finalized") {
    // Auto-charged invoice with no due date: wait for a failed payment instead.
    return "skipped";
  } else {
    dueDate = today;
  }

  const [created] = await db
    .insert(arvoInvoicesTable)
    .values({
      customerName: (invoice.customer_name?.trim() || email.split("@")[0]).slice(0, 120),
      customerEmail: email,
      invoiceNumber: (invoice.number ?? invoice.id).slice(0, 60),
      stripeInvoiceId: invoice.id,
      amountCents,
      currency,
      dueDate,
      tone: "friendly",
      sequenceDay: getSequenceDay(dueDate),
    })
    .returning({ id: arvoInvoicesTable.id, dueDate: arvoInvoicesTable.dueDate });

  log.info({ invoiceId: created?.id, stripeInvoiceId: invoice.id, dueDate }, "Imported Stripe invoice into the recovery sequence");

  if (created && created.dueDate < today) {
    await processInvoiceSequence(created.id);
  }
  return "imported";
}

export const stripeWebhookHandler: RequestHandler = async (req, res) => {
  const signature = req.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature) {
    res.status(400).json({ error: "Missing Stripe signature." });
    return;
  }
  if (!webhookSecret) {
    req.log.error("Stripe webhook signing secret is not configured");
    res.status(503).json({ error: "Stripe webhook is not configured." });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Expected the raw Stripe event body." });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    req.log.warn(
      { err: error instanceof Error ? error.message : "Invalid signature" },
      "Rejected Stripe webhook signature",
    );
    res.status(400).json({ error: "Invalid Stripe signature." });
    return;
  }

  if (IMPORT_EVENTS.has(event.type as string)) {
    try {
      const outcome = await importStripeInvoice(
        event.data.object as Stripe.Invoice,
        event.type as string,
        req.log,
      );
      res.json({ received: true, handled: true, outcome });
    } catch (error) {
      req.log.error({ err: error }, "Could not import Stripe invoice");
      res.status(500).json({ error: "Could not import the invoice." });
    }
    return;
  }

  if (event.type !== "invoice.paid") {
    res.json({ received: true, handled: false });
    return;
  }

  const paidInvoice = event.data.object as Stripe.Invoice;
  const metadataId = Number(paidInvoice.metadata?.arvo_invoice_id);

  try {
    let [localInvoice] = await db
      .select({ id: arvoInvoicesTable.id })
      .from(arvoInvoicesTable)
      .where(eq(arvoInvoicesTable.stripeInvoiceId, paidInvoice.id))
      .limit(1);

    if (!localInvoice && Number.isSafeInteger(metadataId) && metadataId > 0) {
      [localInvoice] = await db
        .select({ id: arvoInvoicesTable.id })
        .from(arvoInvoicesTable)
        .where(eq(arvoInvoicesTable.id, metadataId))
        .limit(1);
    }

    if (!localInvoice) {
      req.log.warn(
        { stripeInvoiceId: paidInvoice.id },
        "Paid Stripe invoice did not match a tracked Arvo invoice",
      );
      res.json({ received: true, handled: true, matched: false });
      return;
    }

    await markInvoicePaid(localInvoice.id, "stripe");
    req.log.info(
      { invoiceId: localInvoice.id, stripeInvoiceId: paidInvoice.id },
      "Stripe payment stopped the invoice recovery sequence",
    );
    res.json({ received: true, handled: true, matched: true });
  } catch (error) {
    req.log.error({ err: error }, "Could not apply Stripe payment event");
    res.status(500).json({ error: "Could not apply the payment event." });
  }
};