import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitFastDraft } from "../commit-engine.js";
import { createStoryProject } from "../project-store.js";
import type { CharacterState } from "../types.js";

describe("extraFields survive a commit and are ignored by commit logic", () => {
  it("preserves extraFields on a character state while applying typed updates", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-engine-extrafields-commit-"));
    const { projectDir } = await createStoryProject({
      rootDir,
      title: "我的修仙副本",
      genre: "xianxia",
      premise: "主角从杂役弟子逆袭。",
      mainCharacterName: "Guo Xu / 主角",
    });
    const statePath = join(projectDir, "characters", "guo-xu", "state.json");
    await writeFile(statePath, `${JSON.stringify({
      characterId: "guo-xu",
      emotion: "平静",
      goal: "查账册",
      extraFields: { 境界: "练气期", 功法: ["奔雷诀"] },
      lastUpdatedChapter: null,
    }, null, 2)}\n`, "utf-8");
    await writeFile(join(projectDir, "drafts", "fast", "chapter-0001.md"), "# 开局\n\n林远推开大门。\n", "utf-8");

    const report = await commitFastDraft({
      projectDir,
      chapter: 1,
      commitPlan: {
        characterUpdates: [{ characterId: "guo-xu", emotion: "alert", goal: "突破练气" }],
      },
    });

    expect(report.passed).toBe(true);
    const after = JSON.parse(await readFile(statePath, "utf-8")) as CharacterState;
    // 内置字段被更新
    expect(after.emotion).toBe("alert");
    expect(after.goal).toBe("突破练气");
    // extraFields 完整保留（入库不蒸发自定义字段）
    expect(after.extraFields?.["境界"]).toBe("练气期");
    expect(after.extraFields?.["功法"]).toEqual(["奔雷诀"]);
  });
});
