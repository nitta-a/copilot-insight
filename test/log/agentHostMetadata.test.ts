import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAgentHostMetadata } from "../../src/log/agentHostMetadata";

suite("Agent Host catalog", () => {
  test("matches SDK sessions and builds the active child chat hierarchy", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-host-"));
    try {
      const storage = path.join(root, "User", "globalStorage");
      await fs.mkdir(storage, { recursive: true });
      const db = new DatabaseSync(path.join(storage, "agent-host.db"));
      db.exec(`CREATE TABLE chats_v2 (chat_uri TEXT, parent_chat TEXT, provider_data TEXT, metadata TEXT, origin TEXT, tombstoned INTEGER);
        INSERT INTO chats_v2 VALUES ('root', NULL, '{"sdkSessionId":"session"}', NULL, NULL, 0);
        INSERT INTO chats_v2 VALUES ('child', 'root', NULL, '{"data":{"summary":"Review"}}', '{"kind":"tool"}', 0);
        INSERT INTO chats_v2 VALUES ('grandchild', 'child', NULL, 'invalid', '{"kind":"user"}', 0);
        INSERT INTO chats_v2 VALUES ('deleted', 'root', NULL, NULL, NULL, 1);
        INSERT INTO chats_v2 VALUES ('broken', NULL, 'invalid', NULL, NULL, 0);`);
      db.close();
      assert.deepStrictEqual(
        [...(await readAgentHostMetadata(path.join(root, "logs")))],
        [
          [
            "session",
            [{ title: "Review", origin: "tool", children: [{ title: "Untitled chat", origin: "user", children: [] }] }],
          ],
        ],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    assert.strictEqual((await readAgentHostMetadata(path.join(root, "logs"))).size, 0);
  });
});
