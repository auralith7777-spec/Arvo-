import { eq } from "drizzle-orm";
import { db, inboxAccountTable } from "@workspace/db";
import { sendEmail } from "./email-recovery";
import { isGmailConfigured } from "./gmail";
import { generateBrief, syncInbox } from "./inbox";
import { logger } from "./logger";

const TICK_MS = 10 * 60 * 1000; // how often we check whether anything is due
const SYNC_EVERY_MS = 30 * 60 * 1000; // background inbox sync cadence
const BRIEF_RETRY_MS = 60 * 60 * 1000; // if the daily brief fails, retry hourly

// Default 01:30 UTC = 07:00 IST. Override with BRIEF_HOUR_UTC / BRIEF_MINUTE_UTC.
const BRIEF_HOUR_UTC = Number(process.env.BRIEF_HOUR_UTC ?? 1);
const BRIEF_MINUTE_UTC = Number(process.env.BRIEF_MINUTE_UTC ?? 30);

let lastSyncAt = 0;
let lastBriefAttemptAt = 0;

function appBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");
}

/**
 * Syncs fresh mail, builds the brief, and emails it to the connected Gmail
 * address. `force` is for the manual button: it sends even if today's brief
 * already went out and doesn't mark the day as done.
 */
export async function sendBriefEmail(options: { force?: boolean } = {}): Promise<string> {
  const [account] = await db.select().from(inboxAccountTable).limit(1);
  if (!account) throw new Error("Connect Gmail first.");

  // Pull in new mail first so the brief isn't stale (3 batches max).
  for (let i = 0; i < 3; i += 1) {
    try {
      const result = await syncInbox();
      if (!result.remaining) break;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, "Sync before brief failed; using what's saved");
      break;
    }
  }

  const brief = await generateBrief();
  const link = appBaseUrl() ? `\n\nOpen your inbox: ${appBaseUrl()}/inbox` : "";
  const today = new Date().toISOString().slice(0, 10);
  await sendEmail(
    { customerEmail: account.email },
    "Your Arvo morning brief",
    `${brief}${link}`,
    options.force ? `arvo-brief-manual-${Date.now()}` : `arvo-brief-${today}`,
  );

  if (!options.force) {
    await db
      .update(inboxAccountTable)
      .set({ lastBriefDate: today })
      .where(eq(inboxAccountTable.id, account.id));
  }
  return account.email;
}

async function tick(): Promise<void> {
  if (!isGmailConfigured()) return;
  const [account] = await db.select().from(inboxAccountTable).limit(1);
  if (!account) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const pastBriefTime =
    now.getUTCHours() > BRIEF_HOUR_UTC ||
    (now.getUTCHours() === BRIEF_HOUR_UTC && now.getUTCMinutes() >= BRIEF_MINUTE_UTC);

  if (pastBriefTime && account.lastBriefDate !== today && Date.now() - lastBriefAttemptAt >= BRIEF_RETRY_MS) {
    lastBriefAttemptAt = Date.now();
    try {
      const sentTo = await sendBriefEmail();
      logger.info({ sentTo }, "Daily inbox brief emailed");
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : err }, "Daily inbox brief failed");
    }
    return;
  }

  if (Date.now() - lastSyncAt >= SYNC_EVERY_MS) {
    lastSyncAt = Date.now();
    try {
      const result = await syncInbox();
      logger.info(result, "Background inbox sync finished");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, "Background inbox sync failed");
    }
  }
}

/**
 * Runs shortly after boot (so a server that just woke from sleep catches up)
 * and then every 10 minutes while the process is alive.
 */
export function startInboxScheduler(): void {
  const first = setTimeout(() => void tick(), 15_000);
  first.unref();
  const interval = setInterval(() => void tick(), TICK_MS);
  interval.unref();
}
