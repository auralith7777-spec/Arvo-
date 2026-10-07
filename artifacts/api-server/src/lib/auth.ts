import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_COOKIE_NAME = "arvo_admin";

/**
 * Constant-time comparison so a login attempt can't be timed to leak
 * how many characters of the password were guessed correctly.
 */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid an early-return
    // timing signal based on length mismatches.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function checkAdminCredentials(
  email: string,
  password: string,
): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set to enable admin login.",
    );
  }

  const emailMatches = safeEquals(email.trim().toLowerCase(), adminEmail.trim().toLowerCase());
  const passwordMatches = safeEquals(password, adminPassword);
  return emailMatches && passwordMatches;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (session !== "ok") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
