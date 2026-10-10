import { IntegrationConfigurationError } from "./email-recovery";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

export type GmailMessage = {
  id: string;
  threadId: string;
  messageIdHeader: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
};

export function isGmailConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function redirectUri(): string {
  const base = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!base) {
    throw new IntegrationConfigurationError(
      "Set PUBLIC_BASE_URL so Google can redirect back after sign-in.",
    );
  }
  return `${base.replace(/\/$/, "")}/api/inbox/oauth/callback`;
}

function requireClient(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new IntegrationConfigurationError(
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Gmail.",
    );
  }
  return { id, secret };
}

export function buildAuthUrl(state: string): string {
  const { id } = requireClient();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(
  params: Record<string, string>,
): Promise<{ access_token: string; refresh_token?: string }> {
  const { id, secret } = requireClient();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      ...params,
    }).toString(),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Google token request failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
  };
}

export function exchangeCode(code: string) {
  return tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const tokens = await tokenRequest({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return tokens.access_token;
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Gmail API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

export async function getProfileEmail(accessToken: string): Promise<string> {
  const profile = await gmailFetch<{ emailAddress: string }>(
    accessToken,
    "/profile",
  );
  return profile.emailAddress;
}

type Part = {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
};

function decodeBase64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function findPlainText(part: Part | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findPlainText(child);
    if (found) return found;
  }
  return "";
}

function parseFrom(value: string): { name: string; address: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), address: match[2].trim().toLowerCase() };
  return { name: "", address: value.trim().toLowerCase() };
}

type RawMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: Part & { headers?: Array<{ name: string; value: string }> };
};

function toMessage(raw: RawMessage): GmailMessage {
  const header = (name: string) =>
    raw.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ??
    "";
  const from = parseFrom(header("from"));
  return {
    id: raw.id,
    threadId: raw.threadId,
    messageIdHeader: header("message-id"),
    fromAddress: from.address,
    fromName: from.name,
    subject: header("subject"),
    snippet: raw.snippet ?? "",
    body: (findPlainText(raw.payload) || raw.snippet || "").slice(0, 3000),
    receivedAt: new Date(Number(raw.internalDate ?? Date.now())),
  };
}

async function listMessages(
  accessToken: string,
  query: string,
  max: number,
): Promise<GmailMessage[]> {
  const list = await gmailFetch<{ messages?: Array<{ id: string }> }>(
    accessToken,
    `/messages?${new URLSearchParams({ q: query, maxResults: String(max) }).toString()}`,
  );
  const messages: GmailMessage[] = [];
  for (const { id } of list.messages ?? []) {
    const raw = await gmailFetch<RawMessage>(
      accessToken,
      `/messages/${id}?format=full`,
    );
    messages.push(toMessage(raw));
  }
  return messages;
}

export function listRecentInbox(accessToken: string, max = 15) {
  return listMessages(accessToken, "in:inbox -category:promotions newer_than:3d", max);
}

export async function listSentExamples(
  accessToken: string,
  max = 5,
): Promise<string[]> {
  const sent = await listMessages(accessToken, "in:sent", max);
  return sent.map((m) => m.body.trim().slice(0, 500)).filter(Boolean);
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function createReplyDraft(
  accessToken: string,
  original: GmailMessage,
  body: string,
): Promise<string> {
  const subject = /^re:/i.test(original.subject)
    ? original.subject
    : `Re: ${original.subject}`;
  const lines = [
    `To: ${original.fromAddress}`,
    `Subject: ${encodeHeader(subject)}`,
    ...(original.messageIdHeader
      ? [
          `In-Reply-To: ${original.messageIdHeader}`,
          `References: ${original.messageIdHeader}`,
        ]
      : []),
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const draft = await gmailFetch<{ id: string }>(accessToken, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw, threadId: original.threadId } }),
  });
  return draft.id;
}
