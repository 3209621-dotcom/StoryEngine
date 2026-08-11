import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectBookExtraFieldKeys } from "../collect-extra-field-keys.js";

describe("collectBookExtraFieldKeys", () => {
  it("unions extraField keys across character, location, asset, and world cards, deduped and sorted", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "story-engine-collect-extra-keys-"));

    // character → characters/<id>/state.json
    await mkdir(join(projectDir, "characters", "guo-xu"), { recursive: true });
    await writeFile(
      join(projectDir, "characters", "guo-xu", "state.json"),
      JSON.stringify({ characterId: "guo-xu", emotion: "平静", goal: "查清真相", extraFields: { 境界: "金丹期" } }),
      "utf-8",
    );

    // location → story/location-bible.json (each entry has extraFields)
    await mkdir(join(projectDir, "story"), { recursive: true });
    await writeFile(
      join(projectDir, "story", "location-bible.json"),
      JSON.stringify({
        version: "v0",
        locations: [
          { id: "loc-1", name: "雷宗", extraFields: { 阵营: "正道" } },
          { id: "loc-2", name: "黑风寨", extraFields: { 危险等级: "高" } },
        ],
      }),
      "utf-8",
    );

    // asset → story/assets.json (each asset has extraFields)
    await writeFile(
      join(projectDir, "story", "assets.json"),
      JSON.stringify({
        version: "v0",
        assets: [{ id: "asset-1", name: "奔雷剑", extraFields: { 功法: ["奔雷诀"] } }],
        containers: [],
      }),
      "utf-8",
    );

    // world → world/state.json
    await mkdir(join(projectDir, "world"), { recursive: true });
    await writeFile(
      join(projectDir, "world", "state.json"),
      JSON.stringify({
        currentPhase: "开局",
        activeConflicts: [],
        activeHooks: [],
        knownSecrets: [],
        extraFields: { 灵气浓度: "稀薄" },
      }),
      "utf-8",
    );

    const keys = await collectBookExtraFieldKeys(projectDir);
    // union of all four sources, stable-sorted
    expect(keys).toEqual(["危险等级", "境界", "功法", "灵气浓度", "阵营"].sort((a, b) => a.localeCompare(b)));
  });

  it("dedupes the same key appearing across multiple cards", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "story-engine-collect-extra-keys-dedupe-"));

    await mkdir(join(projectDir, "characters", "lin-wan"), { recursive: true });
    await writeFile(
      join(projectDir, "characters", "lin-wan", "state.json"),
      JSON.stringify({ characterId: "lin-wan", emotion: "冷静", goal: "复仇", extraFields: { 境界: "筑基" } }),
      "utf-8",
    );

    await mkdir(join(projectDir, "story"), { recursive: true });
    await writeFile(
      join(projectDir, "story", "location-bible.json"),
      JSON.stringify({ version: "v0", locations: [{ id: "loc-1", name: "雷宗", extraFields: { 境界: "无" } }] }),
      "utf-8",
    );

    const keys = await collectBookExtraFieldKeys(projectDir);
    expect(keys).toEqual(["境界"]);
  });

  it("returns [] for an empty project with no extraFields anywhere", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "story-engine-collect-extra-keys-empty-"));
    const keys = await collectBookExtraFieldKeys(projectDir);
    expect(keys).toEqual([]);
  });

  it("returns [] (graceful degradation) for a non-existent project dir without throwing", async () => {
    const keys = await collectBookExtraFieldKeys(join(tmpdir(), "story-engine-collect-extra-keys-does-not-exist-xyz"));
    expect(keys).toEqual([]);
  });

  it("collects character extraFields from profile.json and core.json too", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "story-engine-collect-extra-keys-charfiles-"));
    await mkdir(join(projectDir, "characters", "guo-xu"), { recursive: true });
    await writeFile(
      join(projectDir, "characters", "guo-xu", "profile.json"),
      JSON.stringify({ id: "guo-xu", name: "林远", extraFields: { 血脉: "真龙" } }),
      "utf-8",
    );
    await writeFile(
      join(projectDir, "characters", "guo-xu", "core.json"),
      JSON.stringify({ characterId: "guo-xu", personality: [], extraFields: { 道心: "坚定" } }),
      "utf-8",
    );

    const keys = await collectBookExtraFieldKeys(projectDir);
    expect(keys).toEqual(["血脉", "道心"].sort((a, b) => a.localeCompare(b)));
  });
});
