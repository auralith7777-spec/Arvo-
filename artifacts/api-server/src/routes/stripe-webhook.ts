import Stripe from "stripe";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, arvoInvoicesTable } from "@workspace/db";
import { markInvoicePaid } from "../lib/invoice-utils";

// This client is only used for local webhook signature verification.
// It never makes Stripe API requests, so no Stripe API secret key is needed.
const stripe = new Stripe("sk_test_webhook_signature_verification_only");

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