import { Router, type IRouter } from "express";
import { checkAdminCredentials, SESSION_COOKIE_NAME } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

router.post("/auth/login", (req, res): void => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  let valid: boolean;
  try {
    valid = checkAdminCredentials(email, password);
  } catch (err) {
    logger.error({ err }, "Admin login attempted before ADMIN_EMAIL/ADMIN_PASSWORD were configured");
    res.status(500).json({ error: "Admin login is not configured yet." });
    return;
  }

  if (!valid) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  res.cookie(SESSION_COOKIE_NAME, "ok", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    signed: true,
    maxAge: SEVEN_DAYS_MS,
  });
  res.json({ authenticated: true });
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ authenticated: false });
});

router.get("/auth/me", (req, res): void => {
  const session = req.signedCookies?.[SESSION_COOKIE_NAME];
  res.json({ authenticated: session === "ok" });
});

export default router;
