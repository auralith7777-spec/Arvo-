import { desc, eq, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  GetSettingsResponse,
  RunSequenceCheckResponse,
} from "@workspace/api-zod";
import {
  db,
  arvoInvoicesTable,
  arvoSequenceActionsTable,
} from "@workspace/db";
import { runDailySequence } from "../lib/sequence";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [counts] = await db
    .select({
      trackedCount: sql<number>`count(*)::int`,
      activeCount: sql<number>`count(*) filter (where ${arvoInvoicesTable.status} = 'active')::int`,
      pausedCount: sql<number>`count(*) filter (where ${arvoInvoicesTable.status} = 'paused')::int`,
      paidCount: sql<number>`count(*) filter (where ${arvoInvoicesTable.status} = 'paid')::int`,
    })
    .from(arvoInvoicesTable);

  const outstandingByCurrency = await db
    .select({
      currency: arvoInvoicesTable.currency,
      amountCents: sql<number>`coalesce(sum(${arvoInvoicesTable.amountCents}), 0)::int`,
    })
    .from(arvoInvoicesTable)
    .where(ne(arvoInvoicesTable.status, "paid"))
    .groupBy(arvoInvoicesTable.currency);

  const recentRows = await db
    .select({
      id: arvoSequenceActionsTable.id,
      invoiceId: arvoSequenceActionsTable.invoiceId,
      invoiceNumber: arvoInvoicesTable.invoiceNumber,
      customerName: arvoInvoicesTable.customerName,
      actionDay: arvoSequenceActionsTable.actionDay,
      actionType: arvoSequenceActionsTable.actionType,
      result: arvoSequenceActionsTable.result,
      summary: arvoSequenceActionsTable.summary,
      createdAt: arvoSequenceActionsTable.createdAt,
    })
    .from(arvoSequenceActionsTable)
    .innerJoin(
      arvoInvoicesTable,
      eq(arvoSequenceActionsTable.invoiceId, arvoInvoicesTable.id),
    )
    .orderBy(desc(arvoSequenceActionsTable.createdAt))
    .limit(12);

  res.json(
    GetDashboardResponse.parse({
      trackedCount: counts?.trackedCount ?? 0,
      activeCount: counts?.activeCount ?? 0,
      pausedCount: counts?.pausedCount ?? 0,
      paidCount: counts?.paidCount ?? 0,
      outstandingByCurrency: outstandingByCurrency.map((total) => ({
        currency: total.currency,
        amountCents: Number(total.amountCents),
      })),
      recentActivity: recentRows.map((activity) => ({
        ...activity,
        actionType: activity.actionType as "email" | "call",
        result: activity.result as "sent" | "logged" | "blocked" | "failed",
        createdAt: activity.createdAt.toISOString(),
      })),
    }),
  );
});

router.get("/settings", (_req, res): void => {
  res.json(
    GetSettingsResponse.parse({
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      resendSenderConfigured: Boolean(process.env.RESEND_FROM_EMAIL),
      schedulerEnabled: true,
      webhookPath: "/api/stripe/webhook",
    }),
  );
});

router.post("/sequence/run", async (_req, res): Promise<void> => {
  const result = await runDailySequence();
  res.json(
    RunSequenceCheckResponse.parse({
      ...result,
      message:
        result.blocked > 0
          ? "Some steps need service setup or a retry. Check recent activity."
          : result.completed > 0
            ? "Due sequence actions have been processed."
            : "No sequence actions were due.",
    }),
  );
});

export default router;