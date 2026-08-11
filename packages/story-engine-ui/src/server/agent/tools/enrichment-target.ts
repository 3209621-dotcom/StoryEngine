import { z } from "zod";

import { coerceStringArray } from "./lenient-args.js";

/**
 * 做厚工具的「单体定向」共享件 —— 让角色/资产/地点做厚支持「只补指名的这几个」，而非永远整批重做。
 *
 * 由来（设计 2026-06-25）：做厚原本是全量批处理，用户「补一个新角色」会把已手改过的全员 enrich 覆盖掉
 * （可撤销但要先发现，=默认会发生的数据损坏）。"补即直接厚"这条直路要求补谁就只补谁。落地=各做厚工具
 * inputSchema 摊进 `targetFields`、run 里先 `collect 全部` 再 `filterByEntityTarget`，命中为空时诚实回报。
 * 题材中立、纯确定性、不调 LLM；不传 target=补全部（向后兼容）。
 */
export const targetFields = {
  targetNames: coerceStringArray(z.array(z.string()).optional()).describe(
    "可选：只补全这几个（按名字）。用户刚补充/指名某个时必须填，避免整批重做覆盖已有做厚。省略=补全部。",
  ),
  targetIds: coerceStringArray(z.array(z.string()).optional()).describe(
    "可选：只补全这几个（按 id，比名字精确）；与 targetNames 任一命中即选中。省略=补全部。",
  ),
};

export interface EntityTarget {
  readonly ids: ReadonlySet<string>;
  readonly names: ReadonlySet<string>;
  readonly labels: readonly string[];
}

/** 把 targetNames/targetIds 整理成命中集合；都为空返回 undefined（=补全部）。 */
export function parseEntityTarget(input: {
  readonly targetNames?: readonly string[] | undefined;
  readonly targetIds?: readonly string[] | undefined;
}): EntityTarget | undefined {
  const names = new Set((input.targetNames ?? []).map((s) => s.trim()).filter((s) => s.length > 0));
  const ids = new Set((input.targetIds ?? []).map((s) => s.trim()).filter((s) => s.length > 0));
  if (names.size === 0 && ids.size === 0) return undefined;
  // labels 仅用于「没找到 X」提示：优先用人类可读的名字，仅当只给了 id 时才回显 id（绝不泄露裸 id·匹配仍走 ids/names 集合）。
  return { ids, names, labels: names.size > 0 ? [...names] : [...ids] };
}

/** 按 target 过滤实体清单（实体含 name + 可选 id）；target 为空=原样返回。 */
export function filterByEntityTarget<T extends { readonly name?: string; readonly id?: string }>(
  entities: readonly T[],
  target: EntityTarget | undefined,
): readonly T[] {
  if (!target) return entities;
  return entities.filter(
    (e) => (e.id ? target.ids.has(e.id) : false) || (e.name ? target.names.has(e.name.trim()) : false),
  );
}
