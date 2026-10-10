import crypto from "crypto";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function signScript(script: string): string {
  const secret = process.env.SESSION_SECRET ?? "";
  return crypto.createHmac("sha256", secret).update(script).digest("hex");
}

function validSignature(script: string, sig: string): boolean {
  const expected = Buffer.from(signScript(script));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * Public endpoint Twilio fetches during a call. Trial Twilio accounts can't
 * send inline TwiML, so the script travels in a signed URL instead. The
 * signature stops anyone else from making this endpoint say arbitrary text.
 */
router.all("/voice/twiml", (req, res): void => {
  const script = typeof req.query.script === "string" ? req.query.script : "";
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";

  if (!script || !sig || !validSignature(script, sig)) {
    res.status(403).type("text/plain").send("Invalid signature.");
    return;
  }

  res
    .type("text/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna" language="en-US">${escapeXml(script)}</Say></Response>`,
    );
});

export default router;
