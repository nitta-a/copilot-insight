import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { readChatSessionTitleRecords, resolveWorkspaceStorageRoot } from "../../src/log/chatSessionTitleReader";

suite("chatSessionTitleReader", () => {
  test("resolves workspaceStorage from the logs directory", () => {
    const root = resolveWorkspaceStorageRoot("/Users/test/Library/Application Support/Code/logs");
    assert.strictEqual(root, "/Users/test/Library/Application Support/Code/User/workspaceStorage");
  });

  test("reads custom titles from json and jsonl chat session files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-chat-sessions-"));
    try {
      const workspaceStorageRoot = path.join(tempRoot, "User", "workspaceStorage");
      const workspaceDir = path.join(workspaceStorageRoot, "workspace-1", "chatSessions");
      await fs.mkdir(workspaceDir, { recursive: true });

      await fs.writeFile(
        path.join(workspaceDir, "chat-a.json"),
        JSON.stringify({
          sessionId: "chat-a",
          creationDate: 1760871632297,
          lastMessageDate: 1760871632297,
          customTitle: "アプリの概要説明依頼",
          requests: [{ message: { text: "Explain the app overview" } }],
        }),
        "utf-8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "chat-b.jsonl"),
        [
          JSON.stringify({
            kind: 0,
            v: {
              sessionId: "chat-b",
              creationDate: 1760871632297,
              lastMessageDate: 1760871632397,
              requests: [],
            },
          }),
          JSON.stringify({ kind: 1, k: ["customTitle"], v: "自律性進化トレンドの可視化実装" }),
          JSON.stringify({
            kind: 2,
            k: ["requests"],
            v: [{ message: { text: "Visualize autonomy evolution trends" } }],
          }),
        ].join("\n"),
        "utf-8",
      );

      const records = await readChatSessionTitleRecords(workspaceStorageRoot);

      assert.strictEqual(records.length, 2);
      assert.deepStrictEqual(
        records.map((record) => record.title),
        ["アプリの概要説明依頼", "自律性進化トレンドの可視化実装"],
      );
      assert.strictEqual(records[1]?.firstRequestText, "Visualize autonomy evolution trends");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
