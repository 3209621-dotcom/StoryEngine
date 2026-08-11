/**
 * CommitDeltaCard — 入库 delta 卡：这章正式入库后改了哪些角色/伏笔/线索/时间线/主线目标。
 * 数据来自 commit_apply 的 CommitReport（message.commitReport），复用 summarizeCommitReport 防御解析成
 * 状态行 + 分项清单。用 StepCard 暗金外壳。把每条 detailLine 按首个「：」切成 标签·值 两列展示。
 */
import { StepCard } from "./StepCard.js";
import { summarizeCommitReport } from "../../../utils/commitReportSummary.js";

function splitLabel(line: string): { label: string; value: string } {
  const i = line.indexOf("：");
  return i >= 0 ? { label: line.slice(0, i), value: line.slice(i + 1) } : { label: "", value: line };
}

export function CommitDeltaCard({ report, elapsedMs }: { readonly report: unknown; readonly elapsedMs?: number }) {
  const { statusLine, detailLines } = summarizeCommitReport(report);
  return (
    <StepCard title="定稿" status="done" statusLabel="已定稿" elapsedMs={elapsedMs} defaultOpen>
      <p className="cdc-status">{statusLine}</p>
      <ul className="cdc-list">
        {detailLines.map((line) => {
          const { label, value } = splitLabel(line);
          return (
            <li className="cdc-row" key={line}>
              {label ? <span className="cdc-k">{label}</span> : null}
              <span className="cdc-v">{value}</span>
            </li>
          );
        })}
      </ul>
    </StepCard>
  );
}
