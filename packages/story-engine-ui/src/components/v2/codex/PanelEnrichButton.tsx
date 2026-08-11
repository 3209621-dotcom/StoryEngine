/**
 * PanelEnrichButton — 资料面板上的「补全 / 整理」入口按钮（治『有用工具用户看不见』）。
 *
 * 铁律：右侧对话是唯一控制面。本按钮**只**发一句中文意图给 AI（onSendMessage），
 * 由 agent 走引导卡（story-agent 纪律 8.6）问方向再执行——**绝不前端直连引擎/PUT**。
 * 与 ChapterToolRail 完全同构（onClick=onSendMessage(intent)）。无 onSendMessage 时不渲染。
 */
export default function PanelEnrichButton({
  onSendMessage,
  intent,
  label,
  title,
}: {
  readonly onSendMessage?: (message: string) => void;
  readonly intent: string;
  readonly label: string;
  readonly title?: string;
}) {
  if (!onSendMessage) return null;
  return (
    <button
      type="button"
      className="panel-enrich-btn"
      title={title ?? intent}
      onClick={() => onSendMessage(intent)}
    >
      {label}
    </button>
  );
}
