import type { Invoice } from "@workspace/api-zod";
import { IntegrationConfigurationError, sendEmail } from "./email-recovery";

/**
 * Negotiation policy — the hard bounds the AI is allowed to agree to
 * without a human in the loop. Kept as constants for now; move to
 * per-client settings once there's more than one client.
 */
export const NEGOTIATION_POLICY = {
  minSettlementPercent: 80, // never accept settling for less than this % of the invoice
  maxInstallments: 3, // never agree to more than this many payments
  maxExtensionDays: 30, // never push the final due date out further than this
};

export type NegotiationDecision = "accept" | "counter" | "reject";

export type NegotiationTerms = {
  installments?: number;
  extensionDays?: number;
  settlementPercent?: number;
};

export type NegotiationResult = {
  decision: NegotiationDecision;
  terms: NegotiationTerms | null;
  reasoning: string;
  replySubject: string;
  replyBody: string;
};

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

/**
 * Sends the client's message to Groq along with the negotiation policy
 * and asks it to decide: accept the client's proposal as-is, counter
 * with different terms that stay inside policy, or reject and hold
 * the original terms. Always returns a drafted reply ready to send.
 */
export async function decideNegotiation(
  invoice: Invoice,
  clientMessage: string,
): Promise<NegotiationResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new IntegrationConfigurationError(
      "Add GROQ_API_KEY to enable AI negotiation.",
    );
  }

  const prompt = [
    "You are handling accounts-receivable negotiation for an overdue B2B SaaS invoice.",
    `Invoice amount: ${money(invoice.amountCents, invoice.currency)}`,
    `Customer: ${invoice.customerName}`,
    `Days overdue (sequence day): ${invoice.sequenceDay}`,
    "",
    "The client sent this message in response to a payment reminder:",
    `"""${clientMessage.slice(0, 2000)}"""`,
    "",
    "Your negotiation policy — you must NOT agree to anything outside these bounds:",
    `- Never accept a settlement below ${NEGOTIATION_POLICY.minSettlementPercent}% of the invoice amount.`,
    `- Never agree to more than ${NEGOTIATION_POLICY.maxInstallments} installment payments.`,
    `- Never extend the final due date by more than ${NEGOTIATION_POLICY.maxExtensionDays} days from today.`,
    "",
    "Decide one of: accept (the client's request is within policy, agree to it as stated),",
    "counter (the request is outside policy, or vague — propose specific terms that ARE within policy),",
    "or reject (the message is not a genuine payment proposal, e.g. a dispute or refusal — hold the original terms and ask for payment).",
    "",
    "Return only a JSON object with these exact properties:",
    '- "decision": one of "accept", "counter", "reject"',
    '- "terms": an object with optional numeric fields installments, extensionDays, settlementPercent (the terms you are offering or accepting), or null if decision is "reject"',
    '- "reasoning": one sentence, internal note explaining the decision (not shown to the client)',
    '- "replySubject": the email subject line to send back to the client',
    '- "replyBody": the full email body to send back to the client, professional and specific about the terms',
    "Do not invent discounts, legal threats, or facts not provided. Do not add markdown fences.",
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
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a careful AR negotiation agent. You never agree to terms outside the stated policy, and you always return the required JSON shape.",
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
  if (!content) {
    throw new Error("Groq returned an empty negotiation decision.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Groq returned an invalid negotiation decision.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("decision" in parsed) ||
    !("replySubject" in parsed) ||
    !("replyBody" in parsed)
  ) {
    throw new Error("Groq's negotiation decision is missing required fields.");
  }

  const result = parsed as Record<string, unknown>;
  const decision = result.decision;
  if (decision !== "accept" && decision !== "counter" && decision !== "reject") {
    throw new Error(`Groq returned an invalid decision value: ${String(decision)}`);
  }

  return {
    decision,
    terms:
      decision === "reject" || typeof result.terms !== "object" || result.terms === null
        ? null
        : (result.terms as NegotiationTerms),
    reasoning:
      typeof result.reasoning === "string" ? result.reasoning.slice(0, 500) : "",
    replySubject: String(result.replySubject).slice(0, 180),
    replyBody: String(result.replyBody).slice(0, 6000),
  };
}

export async function sendNegotiationReply(
  invoice: Invoice,
  result: NegotiationResult,
): Promise<void> {
  await sendEmail(
    invoice,
    result.replySubject,
    result.replyBody,
    `arvo-invoice-${invoice.id}-negotiation-${Date.now()}`,
  );
}
