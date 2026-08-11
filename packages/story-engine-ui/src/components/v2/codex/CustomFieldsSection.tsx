import type { ReactNode } from "react";

/**
 * CustomFieldsSection — 通用「自定义字段」展示（受控破例⑦的第④步：让面板装不下的 extraFields 看得见）。
 *
 * 角色/地点/资产/世界观面板都接这一个组件：遍历 extraFields，键→值渲染成卡片（值为数组则逐条列）。
 * 没有任何非空字段时整块返回 null（降级隐藏，照 codex「有则显空则藏」范式）。
 * 样式走 codex 既有 class（`.spec`/`.cell`，作用域 .codex-app，铁律③）。
 */
export function CustomFieldsSection({
  fields,
  title = "自定义字段",
}: {
  readonly fields?: Readonly<Record<string, string | readonly string[]>>;
  readonly title?: string;
}): ReactNode {
  const entries = Object.entries(fields ?? {})
    .map(([key, value]) => {
      const values = (Array.isArray(value) ? value : [value])
        .map((item) => (typeof item === "string" ? item.trim() : String(item)))
        .filter((item) => item.length > 0);
      return [key, values] as const;
    })
    .filter(([, values]) => values.length > 0);

  if (entries.length === 0) return null;

  return (
    <div className="cust-fields">
      <div className="h2">
        <span className="bar" /><h2>{title}</h2><span className="tail" />
        <span className="cnt">{entries.length} 项</span>
      </div>
      <div className="spec">
        {entries.map(([key, values]) => (
          <div key={key} className="cell">
            <h5>{key}</h5>
            <div className="val">
              {values.length === 1 ? (
                values[0]
              ) : (
                values.map((item, i) => <div key={`${key}-${i}`}>{item}</div>)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
