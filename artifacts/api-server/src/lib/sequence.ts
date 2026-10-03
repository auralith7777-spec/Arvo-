import { and, asc, eq, lt } from "drizzle-orm";
import { db, arvoInvoicesTable, arvoSequenceActionsTable } from "@workspace/db";
import type { Invoice } from "@workspace/api-zod";
import { logger } from "./logger";
import { toInvoiceDto } from "./invoice-utils";
import {
  IntegrationConfigurationError,
  sendRecoveryEmail,
} from "./email-recovery";

const ACTION_DAYS = [1, 4, 7, 10, 14] as const;
const EMAIL_DAYS = new Set([1, 4, 10]);

function utcDateValue(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function getSequenceDay(dueDate: string, now = new Date()): number {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const difference = Math.floor((today - utcDateValue(dueDate)) / 86_400_000);
  return Math.max(0, Math.min(14, difference));
}

export type InvoiceProcessResult =
  | { state: "checked"; actionTaken: false }
  | { state: "checked"; actionTaken: true; result: "sent" | "logged" }
  | { state: "blocked" | "failed"; actionTaken: false };

export async function processInvoiceSequence(
  invoiceId: number,
  now = new Date(),
): Promise<InvoiceProcessResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(arvoInvoicesTable)
      .where(eq(arvoInvoicesTable.id, invoiceId))
      .for("update")
      .limit(1);

    if (!row || row.status !== "active") {
      return { state: "checked", actionTaken: false };
    }

    const sequenceDay = getSequenceDay(row.dueDate, now);
    await tx
      .update(arvoInvoicesTable)
      .set({ sequenceDay })
      .where(eq(arvoInvoicesTable.id, row.id));

    const lastActionDate = row.lastActionAt?.toISOString().slice(0, 10);
    if (row.lastActionDay > 0 && lastActionDate === now.toISOString().slice(0, 10)) {
      return { state: "checked", actionTaken: false };
    }

    const actionDay = ACTION_DAYS.find(
      (day) => day <= sequenceDay && day > row.lastActionDay,
    );
    if (!actionDay) {
      return { state: "checked", actionTaken: false };
    }

    const actionType = EMAIL_DAYS.has(actionDay) ? "email" : "call";
    const invoice = toInvoiceDto({ ...row, sequenceDay });

    try {
      let summary: string;
      let subject: string | null = null;
      let result: "sent" | "logged";

      if (actionType === "email") {
        subject = await sendRecoveryEmail(invoice, actionDay, sequenceDay);
        summary = `Day ${actionDay} AI follow-up sent`;
        result = "sent";
      } else {
        summary = `Day ${actionDay} voice call trigger logged (calling not connected)`;
        result = "logged";
      }

      await tx.insert(arvoSequenceActionsTable).values({
        invoiceId: row.id,
        actionDay,
        actionType,
        result,
        summary,
        subject,
      });
      await tx
        .update(arvoInvoicesTable)
        .set({
          sequenceDay,
          lastActionDay: actionDay,
          lastActionTaken: summary,
          lastActionAt: now,
        })
        .where(eq(arvoInvoicesTable.id, row.id));

      return { state: "checked", actionTaken: true, result };
    } catch (error) {
      const result =
        error instanceof IntegrationConfigurationError ? "blocked" : "failed";
      const detail =
        error instanceof Error ? error.message.slice(0, 240) : "Unknown error";
      const summary = `Day ${actionDay} email ${result}: ${detail}`;

      await tx.insert(arvoSequenceActionsTable).values({
        invoiceId: row.id,
        actionDay,
        actionType: "email",
        result,
        summary,
      });
      await tx
        .update(arvoInvoicesTable)
        .set({
          sequenceDay,
          lastActionTaken: summary,
          lastActionAt: now,
        })
        .where(eq(arvoInvoicesTable.id, row.id));

      logger.warn(
        { invoiceId: row.id, actionDay, result, err: detail },
        "Invoice sequence action could not be completed",
      );
      return { state: result, actionTaken: false };
    }
  });
}

export async function runDailySequence(): Promise<{
  checked: number;
  completed: number;
  blocked: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = await db
    .select({ id: arvoInvoicesTable.id })
    .from(arvoInvoicesTable)
    .where(
      and(
        eq(arvoInvoicesTable.status, "active"),
        lt(arvoInvoicesTable.dueDate, today),
      ),
    )
    .orderBy(asc(arvoInvoicesTable.dueDate));

  let completed = 0;
  let blocked = 0;
  for (const invoice of overdue) {
    const result = await processInvoiceSequence(invoice.id);
    if (result.actionTaken) completed += 1;
    if (result.state === "blocked" || result.state === "failed") blocked += 1;
  }

  logger.info(
    { checked: overdue.length, completed, blocked },
    "Daily invoice sequence check finished",
  );
  return { checked: overdue.length, completed, blocked };
}

export function startSequenceScheduler(): void {
  const runAndScheduleNext = async (): Promise<void> => {
    try {
      await runDailySequence();
    } catch (error) {
      logger.error({ err: error }, "Daily invoice sequence check failed");
    }

    const nextMidnight = new Date();
    nextMidnight.setUTCHours(24, 0, 0, 0);
    const timer = setTimeout(
      () => void runAndScheduleNext(),
      Math.max(1_000, nextMidnight.getTime() - Date.now()),
    );
    timer.unref();
  };

  const initialRun = setTimeout(() => void runAndScheduleNext(), 1_000);
  initialRun.unref();
}