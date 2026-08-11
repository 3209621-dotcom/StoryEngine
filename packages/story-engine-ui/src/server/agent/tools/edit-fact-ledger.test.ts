// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editFactLedgerLogic } from "./edit-fact-ledger.js";
import { appendFacts, readFactLedger } from "../fact-ledger/fact-ledger.js";

describe("edit_fact_ledger 纯逻辑", () => {
  it("update：改中某条 → ok + 写盘", async () => {
    const dir = await mkdtemp(join(tmpdir(), "efl-"));
    await appendFacts(dir, 1, ["旧"], "auto");
    const id = (await readFactLedger(dir)).facts[0].id;
    const out = await editFactLedgerLogic({ projectDir: dir, op: "update", id, text: "新" });
    expect(out.ok).toBe(true);
    expect((await readFactLedger(dir)).facts[0].text).toBe("新");
  });
  it("remove 不存在 id → ok:false 诚实回报", async () => {
    const dir = await mkdtemp(join(tmpdir(), "efl-"));
    const out = await editFactLedgerLogic({ projectDir: dir, op: "remove", id: "nope" });
    expect(out.ok).toBe(false);
  });
});
