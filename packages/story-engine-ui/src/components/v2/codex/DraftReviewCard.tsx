/**
 * DraftReviewCard — AI 审稿问题清单卡（随对应 assistant 消息渲染在时间线里，随对话滚动）。
 *
 * 展示 ai_review 的 review：总评 + 问题清单。每条 = 严重度 + 标题 + 说明 + 证据原句 + 「改这处」。
 * 点「改这处」= 给 agent 发一句改写意图（chat 驱动·唯一控制面）：agent 据纪律 5.5 先 read_draft
 * 定位逐字原文、再 revise_draft；一次只改点的那条，绝不自动批量改、不形成审→改→再审循环。
 * 外壳走统一 StepCard（暗金折叠卡 + 状态徽章），body 内仍用 .drc-*（high=暗红 / warning=金 / info=灰）。
 */
import { StepCard } from "./StepCard.js";
import type { DraftReviewView, DraftReviewIssueView } from "../../../api/types.js";

const SEVERITY_LABEL: Record<DraftReviewIssueView["severity"], string> = { high: "重", warning: "中", info: "轻" };

export function DraftReviewCard({ report, onRevise }: {
  readonly report: DraftReviewView;
  readonly onRevise?: (issue: DraftReviewIssueView) => void;
}) {
  const issues = report.issues ?? [];
  return (
    <StepCard
      title="内容审阅"
      status={issues.length > 0 ? "attention" : "done"}
      statusLabel={issues.length > 0 ? `${issues.length} 处` : "无问题"}
      defaultOpen
    >
      {report.summary ? <p className="drc-summary">{report.summary}</p> : null}
      {issues.length === 0 ? null : (
        <ul className="drc-list">
          {issues.map((issue) => (
            <li className="drc-item" key={issue.id}>
              <div className="drc-line">
                <span className={`drc-sev drc-sev-${issue.severity}`}>{SEVERITY_LABEL[issue.severity]}</span>
                <span className="drc-text">{issue.title}</span>
              </div>
              <p className="drc-desc">{issue.description}</p>
              {issue.evidence ? <p className="drc-evi serif">「{issue.evidence}」</p> : null}
              {onRevise ? (
                <button type="button" className="chip drc-fix" onClick={() => onRevise(issue)}>
                  改这处
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </StepCard>
  );
}
