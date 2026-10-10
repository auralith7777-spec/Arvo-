import type { Invoice } from "@workspace/api-zod";
import { IntegrationConfigurationError } from "./email-recovery";
import { signScript } from "../routes/voice";

/**
 * Voice calls are placed through Twilio's REST API. Invoices don't carry
 * a phone number yet, so every call goes to DEMO_CALL_NUMBER. Once clients
 * have phone numbers on file, swap that for the invoice's own number.
 */
export function isVoiceConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER &&
      process.env.DEMO_CALL_NUMBER,
  );
}

function money(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export async function generateCallScript(
  invoice: Invoice,
  actionDay: number,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new IntegrationConfigurationError(
      "Add GROQ_API_KEY to enable AI call scripts.",
    );
  }

  const stage =
    actionDay >= 14
      ? "This is the final call. Be polite but clear that this is the last reminder before the account is escalated for further review."
      : "This is the first phone reminder. Be friendly and helpful, and ask when payment can be expected.";

  const prompt = [
    "Write a short spoken phone script (2 to 4 sentences, under 60 words) for an automated accounts-receivable reminder call.",
    `Customer: ${invoice.customerName}`,
    `Invoice number: ${invoice.invoiceNumber}`,
    `Amount: ${money(invoice.amountCents, invoice.currency)}`,
    stage,
    "Plain spoken English only: no markdown, no stage directions, no legal threats, no invented facts.",
    'Return only a JSON object with one property "script".',
  ].join("\n");

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        temperature: 0.4,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write brief, courteous spoken scripts for payment reminder calls and always return the required JSON shape.",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Groq returned ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty call script.");

  let parsed: { script?: unknown };
  try {
    parsed = JSON.parse(content) as { script?: unknown };
  } catch {
    throw new Error("Groq returned an invalid call script.");
  }
  if (typeof parsed.script !== "string" || !parsed.script.trim()) {
    throw new Error("Groq's call script is missing.");
  }
  return parsed.script.trim().slice(0, 600);
}

export async function placeCall(script: string): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.DEMO_CALL_NUMBER;
  if (!accountSid || !authToken || !from || !to) {
    throw new IntegrationConfigurationError(
      "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and DEMO_CALL_NUMBER to place calls.",
    );
  }

  const baseUrl = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) {
    throw new IntegrationConfigurationError(
      "Set PUBLIC_BASE_URL so Twilio can fetch the call script.",
    );
  }
  const twimlUrl = `${baseUrl.replace(/\/$/, "")}/api/voice/twiml?${new URLSearchParams({ script, sig: signScript(script) }).toString()}`;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Url: twimlUrl }).toString(),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Twilio returned ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as { sid?: string };
  return data.sid ?? "unknown";
}

/** Generates a script for this invoice and places the call. Returns the script used. */
export async function placeRecoveryCall(
  invoice: Invoice,
  actionDay: number,
): Promise<string> {
  const script = await generateCallScript(invoice, actionDay);
  await placeCall(script);
  return script;
}
