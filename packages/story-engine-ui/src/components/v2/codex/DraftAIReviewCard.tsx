/**
 * DraftAIReviewCard — REST 审稿结果卡（随对应 assistant 消息渲染在时间线里，随对话滚动）。
 *
 * 与 agent 工具路径的 DraftReviewCard（message.draftReview）是另一条链路：本卡来自
 * handleDraftAIReview → reviewDraftWithAI，带「按最重要问题生成修订任务」按钮，走
 * onCreateRevisionTask → 写作台修订预览。外壳走统一 StepCard（暗金折叠卡），
 * 有问题默认展开，用户可折叠——不再钉在聊天底部吃视口。
 */
import { StepCard } from "./StepCard.js";
import { uiText } from "../v2Utils.js";
import type { DraftAIReviewIssue, DraftAIReviewReport, DraftAIRevisionSuggestion } from "../../../api/types.js";

export function DraftAIReviewCard({
  review,
  onCreateRevisionTask,
}: {
  readonly review: DraftAIReviewReport;
  readonly onCreateRevisionTask?: (source: {
    readonly issue?: DraftAIReviewIssue;
    readonly suggestion?: DraftAIRevisionSuggestion;
  }) => void;
}) {
  const verdict = {
    ready_to_commit: "内容审阅通过",
    needs_minor_revision: "建议小修",
    needs_major_revision: "建议大修",
    blocked: "暂不建议定稿",
  }[review.verdict];
  const issueCount = review.issues.length;
  const needsAttention = review.issues.some((issue) => issue.severity === "high")
    || review.verdict === "needs_major_revision"
    || review.verdict === "blocked";
  const primaryIssue = review.issues.find((issue) => issue.severity === "high")
    ?? review.issues.find((issue) => issue.severity === "warning")
    ?? review.issues[0];
  const primarySuggestion = review.suggestedRevisions.find((suggestion) => suggestion.priority === "high")
    ?? review.suggestedRevisions.find((suggestion) => suggestion.priority === "medium")
    ?? review.suggestedRevisions[0];
  const primaryRevisionSource = primaryIssue
    ? { issue: primaryIssue }
    : primarySuggestion
      ? { suggestion: primarySuggestion }
      : undefined;

  return (
    <StepCard
      title="内容审阅"
      status={needsAttention ? "attention" : "done"}
      statusLabel={issueCount > 0 ? `${review.score}/100 · ${issueCount} 处问题` : "通过"}
      defaultOpen={issueCount > 0}
    >
      <div className="dair-body">
        <div className="dair-meta">
          <strong>{verdict} · {review.score}/100</strong>
        </div>
        <p className="dair-summary">{uiText(review.summary)}</p>
        {onCreateRevisionTask && primaryRevisionSource ? (
          <button type="button" className="chip dair-primary" onClick={() => onCreateRevisionTask(primaryRevisionSource)}>
            按最重要问题准备修改方案
          </button>
        ) : null}
        {review.strengths.length ? (
          <div className="dair-section">
            <h3 className="dair-h">主要优点</h3>
            <ul className="dair-list">{review.strengths.slice(0, 4).map((item) => <li key={item}>{uiText(item)}</li>)}</ul>
          </div>
        ) : null}
        {review.issues.length ? (
          <div className="dair-section">
            <h3 className="dair-h">主要问题</h3>
            <ul className="dair-list">{review.issues.slice(0, 5).map((issue) => (
              <li key={issue.id} className="dair-item">
                <strong>{uiText(issue.title)}</strong>
                <span className="dair-desc">{uiText(issue.description)}</span>
                {onCreateRevisionTask ? (
                  <button type="button" className="chip" onClick={() => onCreateRevisionTask({ issue })}>准备修改方案</button>
                ) : null}
              </li>
            ))}</ul>
          </div>
        ) : null}
        {review.suggestedRevisions.length ? (
          <div className="dair-section">
            <h3 className="dair-h">修改建议</h3>
            <ul className="dair-list">{review.suggestedRevisions.slice(0, 5).map((suggestion) => (
              <li key={suggestion.id} className="dair-item">
                <strong>{uiText(suggestion.target)}</strong>
                <span className="dair-desc">{uiText(suggestion.suggestion)}</span>
                {onCreateRevisionTask ? (
                  <button type="button" className="chip" onClick={() => onCreateRevisionTask({ suggestion })}>准备修改方案</button>
                ) : null}
              </li>
            ))}</ul>
          </div>
        ) : null}
        {review.blockingReasons.length ? (
          <div className="dair-section">
            <h3 className="dair-h dair-h-danger">定稿风险</h3>
            <ul className="dair-list">{review.blockingReasons.map((item) => <li key={item}>{uiText(item)}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </StepCard>
  );
}
