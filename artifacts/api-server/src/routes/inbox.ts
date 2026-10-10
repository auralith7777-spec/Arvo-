import crypto from "crypto";
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  inboxAccountTable,
  inboxMessagesTable,
  inboxVipsTable,
} from "@workspace/db";
import { IntegrationConfigurationError } from "../lib/email-recovery";
import {
  buildAuthUrl,
  exchangeCode,
  getProfileEmail,
  isGmailConfigured,
} from "../lib/gmail";
import { generateBrief, removeAccount, syncInbox } from "../lib/inbox";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const STATE_COOKIE = "arvo_oauth_state";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

router.get("/inbox/status", async (_req, res): Promise<void> => {
  const [account] = await db.select().from(inboxAccountTable).limit(1);
  res.json({
    configured: isGmailConfigured(),
    connected: Boolean(account),
    email: account?.email ?? null,
  });
});

router.get("/inbox/oauth/start", (req, res): void => {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      signed: true,
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(buildAuthUrl(state));
  } catch (error) {
    res.status(503).type("text/plain").send(errorMessage(error));
  }
});

router.get("/inbox/oauth/callback", async (req, res): Promise<void> => {
  const expected = req.signedCookies?.[STATE_COOKIE];
  const { code, state, error } = req.query;
  res.clearCookie(STATE_COOKIE);

  if (typeof error === "string") {
    res.redirect(`/inbox?error=${encodeURIComponent(error)}`);
    return;
  }
  if (typeof code !== "string" || typeof state !== "string" || !expected || state !== expected) {
    res.redirect("/inbox?error=state_mismatch");
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      res.redirect("/inbox?error=no_refresh_token");
      return;
    }
    const email = await getProfileEmail(tokens.access_token);
    await removeAccount();
    await db.insert(inboxAccountTable).values({ email, refreshToken: tokens.refresh_token });
    res.redirect("/inbox?connected=1");
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, "Gmail OAuth callback failed");
    res.redirect("/inbox?error=exchange_failed");
  }
});

router.post("/inbox/disconnect", async (_req, res): Promise<void> => {
  await removeAccount();
  res.json({ connected: false });
});

router.post("/inbox/sync", async (_req, res): Promise<void> => {
  try {
    res.json(await syncInbox());
  } catch (error) {
    const status = error instanceof IntegrationConfigurationError ? 409 : 502;
    logger.warn({ err: errorMessage(error) }, "Inbox sync failed");
    res.status(status).json({ error: errorMessage(error) });
  }
});

router.get("/inbox/messages", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(inboxMessagesTable)
    .orderBy(desc(inboxMessagesTable.receivedAt))
    .limit(50);
  res.json(rows.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString(), createdAt: r.createdAt.toISOString() })));
});

router.get("/inbox/brief", async (_req, res): Promise<void> => {
  try {
    res.json({ brief: await generateBrief() });
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

router.get("/inbox/vips", async (_req, res): Promise<void> => {
  const rows = await db.select().from(inboxVipsTable).orderBy(inboxVipsTable.email);
  res.json(rows.map((r) => r.email));
});

router.post("/inbox/vips", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  await db.insert(inboxVipsTable).values({ email }).onConflictDoNothing();
  res.json({ email });
});

router.delete("/inbox/vips", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  await db.delete(inboxVipsTable).where(eq(inboxVipsTable.email, email));
  res.json({ email });
});

export default router;
