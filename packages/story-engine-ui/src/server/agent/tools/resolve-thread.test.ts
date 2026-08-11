import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runResolveThread } from "./resolve-thread.js";

async function makeProject(threads: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), "resolve-thread-"));
  await mkdir(join(dir, "story"), { recursive: true });
  await writeFile(join(dir, "story", "threads.json"), `${JSON.stringify({ threads }, null, 2)}\n`, "utf-8");
  return dir;
}

async function readThreads(projectDir: string) {
  return JSON.parse(await readFile(join(projectDir, "story", "threads.json"), "utf-8")).threads as Array<{ id: string; status: string }>;
}

describe("runResolveThread", () => {
  it("marks the unique matching open thread done", async () => {
    const projectDir = await makeProject([
      { id: "intent-a", type: "intent", title: "韩青需要应对安保人员的盘问", status: "open", firstSeenChapter: 2, lastTouchedChapter: 2, evidence: ["被安保拦住。"] },
      { id: "lead-b", type: "lead", title: "王磊倒卖氧气滤芯", status: "open", firstSeenChapter: 4, lastTouchedChapter: 4, evidence: ["王磊有前科。"] },
    ]);

    const result = await runResolveThread(projectDir, "安保盘问");

    expect(result).toMatchObject({ ok: true, resolvedId: "intent-a" });
    expect(result.summary).toContain("已收口");
    const threads = await readThreads(projectDir);
    expect(threads.find((thread) => thread.id === "intent-a")?.status).toBe("done");
    expect(threads.find((thread) => thread.id === "lead-b")?.status).toBe("open");
  });

  it("does not write when there is no match", async () => {
    const projectDir = await makeProject([
      { id: "lead-b", type: "lead", title: "王磊倒卖氧气滤芯", status: "open", firstSeenChapter: 4, lastTouchedChapter: 4, evidence: ["王磊有前科。"] },
    ]);

    const result = await runResolveThread(projectDir, "安保盘问");

    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe("thread_not_found");
    expect(await readThreads(projectDir)).toEqual([
      { id: "lead-b", type: "lead", title: "王磊倒卖氧气滤芯", status: "open", firstSeenChapter: 4, lastTouchedChapter: 4, evidence: ["王磊有前科。"] },
    ]);
  });

  it("does not write when multiple threads match", async () => {
    const projectDir = await makeProject([
      { id: "intent-a", type: "intent", title: "韩青需要应对安保人员的盘问", status: "open", firstSeenChapter: 2, lastTouchedChapter: 2, evidence: ["被安保拦住。"] },
      { id: "intent-b", type: "intent", title: "韩青需要处理安保盘问后续", status: "open", firstSeenChapter: 3, lastTouchedChapter: 3, evidence: ["还要处理。"] },
    ]);

    const result = await runResolveThread(projectDir, "安保盘问");

    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe("multiple_threads_matched");
    expect(result.candidates?.map((candidate) => candidate.id)).toEqual(["intent-a", "intent-b"]);
    expect((await readThreads(projectDir)).every((thread) => thread.status === "open")).toBe(true);
  });
});
