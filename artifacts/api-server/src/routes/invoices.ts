import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateInvoiceBody,
  CreateInvoiceResponse,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  MarkInvoicePaidParams,
  MarkInvoicePaidResponse,
  NegotiateInvoiceBody,
  NegotiateInvoiceParams,
  NegotiateInvoiceResponse,
  UpdateInvoiceStatusBody,
  UpdateInvoiceStatusParams,
  UpdateInvoiceStatusResponse,
} from "@workspace/api-zod";
import { db, arvoInvoicesTable, arvoSequenceActionsTable } from "@workspace/db";
import { markInvoicePaid, toInvoiceDto } from "../lib/invoice-utils";
import { getSequenceDay, processInvoiceSequence } from "../lib/sequence";
import {
  decideNegotiation,
  sendNegotiationReply,
} from "../lib/negotiation";
import { IntegrationConfigurationError } from "../lib/email-recovery";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSupportedCurrency(value: string): boolean {
  return SUPPORTED_CURRENCIES.has(value.toUpperCase());
}

router.get("/invoices", async (req, res): Promise<void> => {
  const query = ListInvoicesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.status) {
    conditions.push(eq(arvoInvoicesTable.status, query.data.status));
  }
  const search = query.data.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const match = or(
      ilike(arvoInvoicesTable.customerName, pattern),
      ilike(arvoInvoicesTable.customerEmail, pattern),
      ilike(arvoInvoicesTable.invoiceNumber, pattern),
    );
    if (match) conditions.push(match);
  }

  const rows = await db
    .select()
    .from(arvoInvoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(arvoInvoicesTable.dueDate), desc(arvoInvoicesTable.createdAt));

  res.json(ListInvoicesResponse.parse(rows.map(toInvoiceDto)));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const body = CreateInvoiceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!isCalendarDate(body.data.dueDate)) {
    res.status(400).json({ error: "Due date must be a valid calendar date." });
    return;
  }
  if (!isSupportedCurrency(body.data.currency)) {
    res.status(400).json({ error: "Currency must be USD, EUR, GBP, CAD, or AUD." });
    return;
  }

  const [created] = await db
    .insert(arvoInvoicesTable)
    .values({
      customerName: body.data.customerName.trim(),
      customerEmail: body.data.customerEmail.trim().toLowerCase(),
      invoiceNumber: body.data.invoiceNumber.trim(),
      stripeInvoiceId: body.data.stripeInvoiceId?.trim() || null,
      amountCents: body.data.amountCents,
      currency: body.data.currency.toUpperCase(),
      dueDate: body.data.dueDate,
      tone: body.data.tone ?? "friendly",
      sequenceDay: getSequenceDay(body.data.dueDate),
    })
    .returning();

  if (!created) {
    res.status(500).json({ error: "Invoice could not be tracked." });
    return;
  }

  if (created.dueDate < new Date().toISOString().slice(0, 10)) {
    await processInvoiceSequence(created.id);
  }

  const [refreshed] = await db
    .select()
    .from(arvoInvoicesTable)
    .where(eq(arvoInvoicesTable.id, created.id))
    .limit(1);
  res.status(201).json(CreateInvoiceResponse.parse(toInvoiceDto(refreshed ?? created)));
});

router.patch("/invoices/:id/status", async (req, res): Promise<void> => {
  const params = UpdateInvoiceStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateInvoiceStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(arvoInvoicesTable)
    .where(eq(arvoInvoicesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }
  if (existing.status === "paid") {
    res.status(409).json({ error: "Paid invoices cannot be resumed or paused." });
    return;
  }

  const [updated] = await db
    .update(arvoInvoicesTable)
    .set({ status: body.data.status })
    .where(eq(arvoInvoicesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }
  if (updated.status === "active") {
    await processInvoiceSequence(updated.id);
    const [refreshed] = await db
      .select()
      .from(arvoInvoicesTable)
      .where(eq(arvoInvoicesTable.id, updated.id))
      .limit(1);
    res.json(UpdateInvoiceStatusResponse.parse(toInvoiceDto(refreshed ?? updated)));
    return;
  }
  res.json(UpdateInvoiceStatusResponse.parse(toInvoiceDto(updated)));
});

router.post("/invoices/:id/mark-paid", async (req, res): Promise<void> => {
  const params = MarkInvoicePaidParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const paid = await markInvoicePaid(params.data.id, "dashboard");
  if (!paid) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }
  res.json(MarkInvoicePaidResponse.parse(toInvoiceDto(paid)));
});

router.post("/invoices/:id/negotiate", async (req, res): Promise<void> => {
  const params = NegotiateInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = NegotiateInvoiceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(arvoInvoicesTable)
    .where(eq(arvoInvoicesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }
  if (existing.status === "paid") {
    res.status(409).json({ error: "This invoice is already paid." });
    return;
  }

  const invoice = toInvoiceDto(existing);

  let decision;
  try {
    decision = await decideNegotiation(invoice, body.data.clientMessage);
  } catch (error) {
    const status =
      error instanceof IntegrationConfigurationError ? 503 : 502;
    const message =
      error instanceof Error ? error.message : "Negotiation decision failed.";
    logger.warn({ invoiceId: invoice.id, err: message }, "Negotiation decision failed");
    res.status(status).json({ error: message });
    return;
  }

  let emailSent = false;
  try {
    await sendNegotiationReply(invoice, decision);
    emailSent = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn(
      { invoiceId: invoice.id, err: message },
      "Negotiation reply drafted but the email could not be sent",
    );
  }

  const summary = `Negotiation ${decision.decision}${
    decision.terms
      ? ` (${Object.entries(decision.terms)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")})`
      : ""
  } — ${decision.reasoning}`.slice(0, 500);

  await db.insert(arvoSequenceActionsTable).values({
    invoiceId: invoice.id,
    actionDay: existing.sequenceDay,
    actionType: "negotiation",
    result: emailSent ? "sent" : "logged",
    summary,
    subject: decision.replySubject,
  });

  await db
    .update(arvoInvoicesTable)
    .set({
      lastActionTaken: summary,
      lastActionAt: new Date(),
    })
    .where(eq(arvoInvoicesTable.id, invoice.id));

  res.json(
    NegotiateInvoiceResponse.parse({
      decision: decision.decision,
      terms: decision.terms,
      reasoning: decision.reasoning,
      replySubject: decision.replySubject,
      replyBody: decision.replyBody,
      emailSent,
    }),
  );
});

export default router;