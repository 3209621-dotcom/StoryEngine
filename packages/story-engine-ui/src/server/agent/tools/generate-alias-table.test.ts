// @vitest-environment node
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ALIAS_TABLE_RELATIVE_PATH, readAliasTable, type AliasTable } from "../alias-generator/alias-generator.js";
import { generateAliasTableLogic } from "./generate-alias-table.js";

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "generate-alias-tool-"));
  await mkdir(join(dir, "story"), { recursive: true });
  await writeFile(
    join(dir, "story", "character-bible.json"),
    JSON.stringify({
      version: "v0",
      characters: [
        { id: "c-guo", name: "林远", role: "总裁" },
        { id: "c-lin", name: "苏楚瑶", role: "老师" },
      ],
    }, null, 2),
    "utf-8",
  );
  return dir;
}

describe("generate_alias_table tool logic", () => {
  it("writes .story-engine-ui/alias-tables.json and returns conflicts plus merge report", async () => {
    const projectDir = await tempProject();

    const out = await generateAliasTableLogic({
      projectDir,
      proposeAliases: async (character) => character.name === "林远" ? ["林少", "远哥"] : [],
    });
    const disk = JSON.parse(await readFile(join(projectDir, ALIAS_TABLE_RELATIVE_PATH), "utf-8"));
    const aliasTable = out.aliasTable as AliasTable;

    expect(out.ok).toBe(true);
    expect(out.summary).toContain("生成/合并 2 个角色别名");
    expect(out.summary).toContain("给林远提议：林少、远哥");
    expect(out.refreshScope).toBe("foundation");
    expect(aliasTable.byEntity["c-guo"]?.aliases).toEqual(["远", "林", "林总", "林少", "远哥"]);
    expect(disk.byEntity["c-lin"].aliases).toEqual(["楚瑶", "苏", "苏老师"]);
    expect(out.mergeReport).toMatchObject({
      preservedUserAdditions: 0,
      preservedUserRemovals: 0,
    });
  });

  it("exports a pure reader that returns an empty table when the file is missing", async () => {
    const projectDir = await tempProject();

    await expect(readAliasTable(projectDir)).resolves.toEqual({
      version: "v0",
      byEntity: {},
      conflicts: [],
    });
  });

  it("falls back to rules and reports honestly when alias proposal fails", async () => {
    const projectDir = await tempProject();

    const out = await generateAliasTableLogic({
      projectDir,
      proposeAliases: async () => {
        throw new Error("model unavailable");
      },
    });
    const aliasTable = out.aliasTable as AliasTable;

    expect(out.ok).toBe(true);
    expect(out.summary).toContain("LLM 不可用，仅规则生成");
    expect(out.warnings).toEqual(["LLM 不可用，仅规则生成：model unavailable"]);
    expect(aliasTable.byEntity["c-guo"]?.aliases).toEqual(["远", "林", "林总"]);
  });

  it("falls back to rules when creating the configured alias proposer fails", async () => {
    const projectDir = await tempProject();

    const out = await generateAliasTableLogic({
      projectDir,
      createProposer: async () => {
        throw new Error("model settings missing");
      },
    });

    expect(out.ok).toBe(true);
    expect(out.summary).toContain("LLM 不可用，仅规则生成");
    expect(out.warnings).toEqual(["LLM 不可用，仅规则生成：model settings missing"]);
  });
});
