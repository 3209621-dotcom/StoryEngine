/**
 * 收集本书四类卡（角色、地点、资产、世界观）已有的自定义字段（extraFields）键名并集。
 *
 * 用途：归档器（资料管家）在新建 extraFields 字段时，要优先复用本书已有的字段名，
 * 避免把已有的「境界」另造成「修为等级」。本函数把实际已有的键名采集出来喂进归档 prompt，
 * 闭合「字段复用」环。
 *
 * 只收集键名，不收集值。读文件全程优雅降级：任意一处读失败/不存在都跳过，绝不抛出，
 * 以免归档因采集失败而崩。空项目 / 无 extraFields → 返回 []。
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  readAssetLedger,
  readCharacterCore,
  readCharacterProfile,
  readCharacterState,
  readLocationBible,
  readWorldState,
} from "./project-store.js";

type ExtraFields = Record<string, string | readonly string[]> | undefined;

function collectKeysInto(target: Set<string>, extraFields: ExtraFields): void {
  if (!extraFields || typeof extraFields !== "object") return;
  for (const key of Object.keys(extraFields)) {
    const trimmed = key.trim();
    if (trimmed) target.add(trimmed);
  }
}

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.then((value) => value, () => undefined);
}

export async function collectBookExtraFieldKeys(projectDir: string): Promise<readonly string[]> {
  const keys = new Set<string>();

  // 1. 角色：characters/<id>/{state,profile,core}.json 的 extraFields。
  //    枚举角色目录（与 state-overview 的 readCharacters 一致），逐卡读取并降级。
  const charDirs = await readdir(join(projectDir, "characters"), { withFileTypes: true }).catch(() => []);
  await Promise.all(
    charDirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const [state, profile, core] = await Promise.all([
          safe(readCharacterState(projectDir, entry.name)),
          safe(readCharacterProfile(projectDir, entry.name)),
          safe(readCharacterCore(projectDir, entry.name)),
        ]);
        collectKeysInto(keys, state?.extraFields);
        collectKeysInto(keys, profile?.extraFields);
        collectKeysInto(keys, core?.extraFields);
      }),
  );

  // 2. 地点：story/location-bible.json 每个 entry 的 extraFields。
  const locationBible = await safe(readLocationBible(projectDir));
  for (const location of locationBible?.locations ?? []) {
    collectKeysInto(keys, location.extraFields);
  }

  // 3. 资产：story/assets.json 每个 asset 的 extraFields。
  const assetLedger = await safe(readAssetLedger(projectDir));
  for (const asset of assetLedger?.assets ?? []) {
    collectKeysInto(keys, asset.extraFields);
  }

  // 4. 世界观：world/state.json 的 extraFields。
  const worldState = await safe(readWorldState(projectDir));
  collectKeysInto(keys, worldState?.extraFields);

  return [...keys].sort((a, b) => a.localeCompare(b));
}
