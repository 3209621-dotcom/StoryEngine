/**
 * AgentErrorCard — 聊天错误专用卡（P0-1）。
 * 正文只写人话；「重试这一步」走既有 retry-agent；原始报错藏在默认收起的技术详情。
 */
import { useState } from "react";
import type { SuggestedAction } from "../../../type-defs/workflow.js";

const FRIENDLY_BODY = "AI 服务暂时没响应，本次没有改动。";

export function agentErrorFriendlyBody(): string {
  return FRIENDLY_BODY;
}

export default function AgentErrorCard(props: {
  readonly detail?: string;
  readonly retryAction?: SuggestedAction | null;
  readonly chatLoading?: boolean;
  readonly onRetry?: (action: SuggestedAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = `${props.detail ?? ""}`.trim();
  const retry = props.retryAction ?? null;
  const busy = Boolean(props.chatLoading);

  return (
    <div className="agent-error-card" role="alert">
      <p className="aec-body">{FRIENDLY_BODY}</p>
      <div className="aec-actions">
        {retry ? (
          <button
            type="button"
            className="aec-retry"
            disabled={busy || !props.onRetry}
            onClick={() => {
              if (!busy && props.onRetry) props.onRetry(retry);
            }}
          >
            重试这一步
          </button>
        ) : null}
        {detail ? (
          <button
            type="button"
            className="aec-detail-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "收起技术详情" : "技术详情"}
          </button>
        ) : null}
      </div>
      {open && detail ? <pre className="aec-detail">{detail}</pre> : null}
    </div>
  );
}
