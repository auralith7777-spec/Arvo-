import { ReplitConnectors } from "@replit/connectors-sdk";
import type { Invoice } from "@workspace/api-zod";

type RecoveryEmail = {
  subject: string;
  body: string;
};

export class IntegrationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationConfigurationError";
  }
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function emailHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#24302c">${paragraphs}</div>`;
}

function toneDirection(day: number): string {
  if (day === 1) {
    return "Polite and helpful. Assume this may have been an oversight. Ask whether they can confirm the payment timing.";
  }
  if (day === 4) {
    return "Slightly firmer but still collaborative. Clearly state the invoice is overdue and ask for a payment date or an update.";
  }
  return "Clear urgency without threats. State that the invoice remains overdue and ask for payment or a concrete update promptly.";
}

async function generateRecoveryEmail(
  invoice: Invoice,
  actionDay: number,
  daysOverdue: number,
): Promise<RecoveryEmail> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new IntegrationConfigurationError(
      "Add GROQ_API_KEY to enable AI-written follow-up emails.",
    );
  }

  const prompt = [
    "Write a concise business accounts-receivable follow-up email for an overdue B2B SaaS invoice.",
    `Customer: ${invoice.customerName}`,
    `Invoice number: ${invoice.invoiceNumber}`,
    `Amount: ${money(invoice.amountCents, invoice.currency)}`,
    `Due date: ${invoice.dueDate}`,
    `Days overdue: ${daysOverdue}`,
    `Client tone preference: ${invoice.tone}`,
    `Sequence-day tone: ${toneDirection(actionDay)}`,
    "Use a natural, respectful tone matched to the client preference while preserving the sequence-day firmness.",
    "Do not invent payment links, late fees, legal consequences, or facts not provided.",
    "Return only a JSON object with string properties subject and body. Do not add a signature or markdown fences.",
  ].join("\n");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen3.8-27b",
      temperature: 0.55,
      max_tokens: 450,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write precise, courteous B2B invoice reminders. Never make up payment details.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Groq returned ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq returned an empty email draft.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Groq returned an invalid email draft.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("subject" in parsed) ||
    !("body" in parsed) ||
    typeof parsed.subject !== "string" ||
    typeof parsed.body !== "string" ||
    !parsed.subject.trim() ||
    !parsed.body.trim()
  ) {
    throw new Error("Groq's email draft is missing a subject or body.");
  }

  return {
    subject: parsed.subject.trim().slice(0, 180),
    body: parsed.body.trim().slice(0, 6000),
  };
}

export async function sendRecoveryEmail(
  invoice: Invoice,
  actionDay: number,
  daysOverdue: number,
): Promise<string> {
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    throw new IntegrationConfigurationError(
      "Set RESEND_FROM_EMAIL to a verified sender address in Resend.",
    );
  }

  const draft = await generateRecoveryEmail(invoice, actionDay, daysOverdue);
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `arvo-invoice-${invoice.id}-day-${actionDay}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [invoice.customerEmail],
      subject: draft.subject,
      text: draft.body,
      html: emailHtml(draft.body),
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Resend returned ${response.status}: ${detail}`);
  }

  return draft.subject;
}