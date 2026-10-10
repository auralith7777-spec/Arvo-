import {
  boolean,
  index,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** The single connected Gmail account (Arvo is a single-admin app for now). */
export const inboxAccountTable = pgTable("inbox_account", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  refreshToken: text("refresh_token").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const inboxMessagesTable = pgTable(
  "inbox_messages",
  {
    id: serial("id").primaryKey(),
    gmailId: text("gmail_id").notNull().unique(),
    threadId: text("thread_id").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name").notNull().default(""),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    category: text("category").notNull(),
    isVip: boolean("is_vip").notNull().default(false),
    reasoning: text("reasoning").notNull().default(""),
    draftReply: text("draft_reply"),
    gmailDraftId: text("gmail_draft_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("inbox_messages_received_at_idx").on(table.receivedAt)],
);

export const inboxVipsTable = pgTable("inbox_vips", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
