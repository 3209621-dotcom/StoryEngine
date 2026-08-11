import type { ChangeEvent, KeyboardEvent } from "react";
import type { FindResult } from "./findReplace.js";

/**
 * 查找替换面板（阶段三块④）：编辑器内 Ctrl+F 唤出。纯展示——查找/替换/导航/计数由 WritingPaper 驱动 findReplace。
 * 当前匹配靠编辑器选区原生高亮；面板只管输入与按钮。
 */
export default function FindReplacePanel({
  query,
  replaceText,
  caseSensitive,
  matchInfo,
  onQueryChange,
  onReplaceChange,
  onToggleCase,
  onFindPrev,
  onFindNext,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
}: {
  readonly query: string;
  readonly replaceText: string;
  readonly caseSensitive: boolean;
  readonly matchInfo: FindResult;
  readonly onQueryChange: (value: string) => void;
  readonly onReplaceChange: (value: string) => void;
  readonly onToggleCase: () => void;
  readonly onFindPrev: () => void;
  readonly onFindNext: () => void;
  readonly onReplaceCurrent: () => void;
  readonly onReplaceAll: () => void;
  readonly onClose: () => void;
}) {
  const handleQuery = (event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value);
  const handleReplace = (event: ChangeEvent<HTMLInputElement>) => onReplaceChange(event.target.value);
  const handleQueryKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onFindPrev();
      else onFindNext();
    }
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };
  // 未导航时（current=0）显示「N 处」，导航后显示「当前/总数」；无匹配显示「无匹配」；空查询不显示。
  const countLabel = matchInfo.total === 0
    ? (query ? "无匹配" : "")
    : matchInfo.current > 0
      ? `${matchInfo.current}/${matchInfo.total}`
      : `${matchInfo.total} 处`;

  return (
    <div className="se-v2-find-panel" role="search" aria-label="查找替换">
      <div className="se-v2-find-row">
        <input
          className="se-v2-find-input"
          placeholder="查找"
          aria-label="查找"
          value={query}
          onChange={handleQuery}
          onKeyDown={handleQueryKey}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <span className="se-v2-find-count" aria-live="polite">{countLabel}</span>
        <button className="se-v2-find-btn" type="button" onClick={onFindPrev} disabled={!matchInfo.total} title="上一个 (Shift+Enter)" aria-label="上一个">↑</button>
        <button className="se-v2-find-btn" type="button" onClick={onFindNext} disabled={!matchInfo.total} title="下一个 (Enter)" aria-label="下一个">↓</button>
        <button className={`se-v2-find-btn${caseSensitive ? " is-active" : ""}`} type="button" onClick={onToggleCase} title="区分大小写" aria-pressed={caseSensitive}>Aa</button>
        <button className="se-v2-find-btn" type="button" onClick={onClose} title="关闭 (Esc)" aria-label="关闭查找替换">✕</button>
      </div>
      <div className="se-v2-find-row">
        <input className="se-v2-find-input" placeholder="替换为" aria-label="替换为" value={replaceText} onChange={handleReplace} />
        <button className="se-v2-find-btn se-v2-find-text-btn" type="button" onClick={onReplaceCurrent} disabled={!query}>替换</button>
        <button className="se-v2-find-btn se-v2-find-text-btn" type="button" onClick={onReplaceAll} disabled={!matchInfo.total}>全部替换</button>
      </div>
    </div>
  );
}
