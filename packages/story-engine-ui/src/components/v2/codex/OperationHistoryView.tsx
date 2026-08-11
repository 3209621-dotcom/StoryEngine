/**
 * OperationHistoryView —— 资料中心/写作台 同级的「操作历史」主区视图（R3#3）。
 *
 * 修：旧入口点左侧「操作历史」只触发一个被 projectPath 门控的全局模态，真书路径异常或 summary-only 书时
 * 静默不出、主区仍是正文书桌。改成确定性主区视图（与「资料中心/写作台」同构、点了必显），不依赖模态是否挂载。
 * 复用既有只读取数/恢复接口（fetchSnapshots / restoreSnapshotApi）——恢复线本就被认可，不新增写入旁路（守铁律②）。
 */
import { useEffect, useState } from "react";
import { fetchSnapshots, restoreSnapshotApi } from "../../../api/client.js";
import type { SnapshotEntryDto } from "../../../api/types.js";
import { drainAutosave, resumeAutosave, suspendAutosave } from "../../../utils/autosaveControl.js";
import { restoreSnapshotSafely } from "../../../utils/safeSnapshotRestore.js";

function formatTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

function formatRelativeTime(epochSeconds: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (elapsedSeconds < 60) return "刚刚";
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)} 小时前`;
  return `${Math.floor(elapsedSeconds / 86400)} 天前`;
}

export default function OperationHistoryView({ projectPath }: { readonly projectPath: string | null | undefined }) {
  const [snapshots, setSnapshots] = useState<SnapshotEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    let alive = true;
    fetchSnapshots(projectPath)
      .then((list) => { if (alive) setSnapshots(list); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [projectPath]);

  const handleRestore = async (id: string): Promise<void> => {
    if (!projectPath) return;
    setRestoring(id);
    setError(null);
    try {
      await restoreSnapshotSafely({
        suspend: suspendAutosave,
        drain: drainAutosave,
        restore: () => restoreSnapshotApi(projectPath, id),
        reload: () => window.location.reload(),
        resumeOnFailure: resumeAutosave,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRestoring(null);
    }
  };

  return (
    <div className="op-history">
      <div className="topbar">
        <div className="crumbs"><b>操作历史</b><span className="sep">/</span><span className="here">自动存档与一键恢复</span></div>
      </div>
      <div className="op-history-body">
        <p className="op-history-hint">每次 AI 写入前都会自动创建存档点。点「恢复到这里」即可回到那个时刻，恢复本身也可以再撤销。</p>
        {!projectPath ? <div className="op-history-empty">请先打开一本真实的本地项目，才能查看操作历史。</div> : null}
        {projectPath && error ? <div className="op-history-error">读取存档失败：{error}</div> : null}
        {projectPath && !error && snapshots === null ? <div className="op-history-empty">正在读取存档列表…</div> : null}
        {projectPath && snapshots !== null && snapshots.length === 0 ? (
          <div className="op-history-empty">还没有任何存档。AI 第一次写入前会自动创建。</div>
        ) : null}
        {projectPath && snapshots !== null && snapshots.length > 0 ? (
          <div className="op-history-list">
            {snapshots.map((snapshot) => (
              <article key={snapshot.id} className="op-history-item">
                <strong>{snapshot.label}</strong>
                <span className="op-history-time" title={formatTime(snapshot.timestamp)}>{formatRelativeTime(snapshot.timestamp)}</span>
                <button disabled={restoring !== null} onClick={() => void handleRestore(snapshot.id)} type="button">
                  {restoring === snapshot.id ? "恢复中……" : "恢复到这里"}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
