/**
 * 覆盖现有非空草稿前建一次轻量快照（M6）。
 *
 * generate_draft / revise_draft 用 createTool（非 writeTool）刻意不建 git 快照——草稿是「待保存」的工作稿。
 * 但「再写一版」或局部修订会**覆盖**已有草稿，没快照则旧稿既无「撤销到此」也无快照历史、不可恢复
 * （存档面板还写「每次 AI 写入前自动存档」打脸）。
 *
 * 本 helper：当前章已有非空草稿才建快照（首次出稿无旧稿可丢，不建、不留无意义提交）；返回 snapshotId，
 * 由工具并入 output（ok 时）→ agentChatClient 透传 → recordTurnEffects 据此挂「撤销到此」。
 */
import { readFile } from "node:fs/promises";

import { createSnapshot } from "../../lib/snapshot.js";
import { defaultDraftPath, stripLeadingMarkdownChapterHeading } from "../../lib/project-io.js";

export async function snapshotBeforeDraftOverwrite(
  projectDir: string,
  chapter: number,
  label: string,
): Promise<string | undefined> {
  const draftPath = defaultDraftPath(projectDir, chapter);
  const existing = await readFile(draftPath, "utf-8").catch(() => "");
  if (stripLeadingMarkdownChapterHeading(existing).trim().length === 0) return undefined;
  const snapshot = await createSnapshot(projectDir, label);
  return snapshot.id;
}
