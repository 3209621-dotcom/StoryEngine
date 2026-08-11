/**
 * 「撤销到此」reload 的一次性标记（H5）。
 *
 * undoToTurn 先 git restore（把磁盘还原到回合起点）+ 把截断后的干净对话写进 sessionStorage，再整页 reload。
 * 但 git 快照用 `git add -A` 把对话持久化文件 `.story-engine-ui/chapter-workspaces/*.json` 也卷了进去 →
 * restore 把对话文件还原成回合起点的脏态（含刚撤销掉的孤儿消息）。reload 时 openProject 默认让磁盘
 * `snapshot.messages` 压过 sessionStorage → 孤儿气泡复活。
 *
 * 标记让那一次（且仅那一次）reload 的 openProject 忽略磁盘对话、改用 sessionStorage 的干净截断；
 * 随后 openProject 把干净对话写进 workspace → autosave 自动写回磁盘自愈，下次正常开书不受影响。
 */
const UNDO_PREFER_SESSION_KEY = "se-undo-prefer-session";

/** undoToTurn reload 前调用：标记「下一次 openProject 优先用 sessionStorage 对话、忽略磁盘脏态」。 */
export function markUndoReloadPreferSession(): void {
  try {
    window.sessionStorage.setItem(UNDO_PREFER_SESSION_KEY, "1");
  } catch {
    // sessionStorage 不可用（隐私模式等）时降级：标记失效，退回默认磁盘优先（不致命，仅极端环境下复活）。
  }
}

/** openProject 开头调用：读出并立即清除标记（一次性，绝不影响后续正常开书）。 */
export function consumeUndoReloadPreferSession(): boolean {
  try {
    const flagged = window.sessionStorage.getItem(UNDO_PREFER_SESSION_KEY) === "1";
    if (flagged) window.sessionStorage.removeItem(UNDO_PREFER_SESSION_KEY);
    return flagged;
  } catch {
    return false;
  }
}
