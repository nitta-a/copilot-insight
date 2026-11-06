import * as path from "node:path";
import type { AgentHostChat } from "../types";

/** Local Agent Host catalog links SDK chats to their visible child chats. */
export async function readAgentHostMetadata(logBaseDir: string): Promise<Map<string, AgentHostChat[]>> {
  const result = new Map<string, AgentHostChat[]>();
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(path.dirname(logBaseDir), "User", "globalStorage", "agent-host.db"), {
      readOnly: true,
    });
    try {
      const rows = db
        .prepare(`SELECT chat_uri, parent_chat, provider_data, metadata, origin
        FROM chats_v2 WHERE tombstoned = 0`)
        .all();
      const children = new Map<string, typeof rows>();
      for (const row of rows) {
        if (typeof row.parent_chat === "string") {
          const siblings = children.get(row.parent_chat) ?? [];
          siblings.push(row);
          children.set(row.parent_chat, siblings);
        }
      }
      const json = (value: unknown): Record<string, unknown> => {
        try {
          const parsed: unknown = typeof value === "string" ? JSON.parse(value) : null;
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
        } catch {
          return {};
        }
      };
      const childChats = (parent: string, visited: Set<string>): AgentHostChat[] =>
        (children.get(parent) ?? []).flatMap((row) => {
          if (typeof row.chat_uri !== "string" || visited.has(row.chat_uri)) {
            return [];
          }
          const metadata = json(row.metadata);
          const data =
            metadata.data && typeof metadata.data === "object" ? (metadata.data as Record<string, unknown>) : {};
          const title = typeof data.summary === "string" ? data.summary.replace(/\s+/g, " ").trim().slice(0, 160) : "";
          const kind = json(row.origin).kind;
          return [
            {
              title: title || "Untitled chat",
              origin: kind === "tool" || kind === "user" ? kind : null,
              children: childChats(row.chat_uri, new Set([...visited, row.chat_uri])),
            },
          ];
        });
      for (const row of rows) {
        const sessionId = json(row.provider_data).sdkSessionId;
        if (typeof sessionId === "string" && typeof row.chat_uri === "string") {
          const found = childChats(row.chat_uri, new Set([row.chat_uri]));
          if (!result.has(sessionId) || found.length > result.get(sessionId)!.length) {
            result.set(sessionId, found);
          }
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Agent Host storage and node:sqlite are optional.
  }
  return result;
}
