import { useEffect, useState } from "react";
import { fetchSnapshots, restoreSnapshotApi } from "../api/client.js";
import type { SnapshotEntryDto } from "../api/types.js";
import { drainAutosave, resumeAutosave, suspendAutosave } from "../utils/autosaveControl.js";
import { restoreSnapshotSafely } from "../utils/safeSnapshotRestore.js";

export interface SnapshotHistoryDialogProps {
  readonly projectPath: string;
  readonly onClose: () => void;
  readonly onRestored: () => void;
}

function formatTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

export default function SnapshotHistoryDialog({ projectPath, onClose, onRestored }: SnapshotHistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<SnapshotEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    fetchSnapshots(projectPath).then(setSnapshots).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectPath]);

  const handleRestore = async (id: string) => {
    setRestoring(id);
    setError(null);
    try {
      await restoreSnapshotSafely({
        suspend: suspendAutosave,
        drain: drainAutosave,
        restore: () => restoreSnapshotApi(projectPath, id),
        reload: onRestored,
        resumeOnFailure: resumeAutosave,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRestoring(null);
    }
  };

  return (
    <div className="usage-backdrop" role="presentation" onClick={onClose}>
      <section aria-modal="true" className="usage-dialog" role="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>操作历史</p>
            <h2>自动存档与一键恢复</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </header>
        <p className="usage-empty">每次 AI 写入前都会自动存档。点“恢复到这里”即可回到那个时刻，恢复本身也可以再撤销。</p>
        {error ? <div className="usage-error">{error}</div> : null}
        {!error && snapshots === null ? <div className="usage-empty">正在读取存档列表...</div> : null}
        {snapshots !== null && snapshots.length === 0 ? (
          <div className="usage-empty">还没有任何存档。AI 第一次写入前会自动创建。</div>
        ) : null}
        {snapshots !== null && snapshots.length > 0 ? (
          <section className="usage-recent">
            <h3>存档列表（新到旧）</h3>
            <div className="usage-table">
              {snapshots.map((snapshot) => (
                <article key={snapshot.id}>
                  <strong>{snapshot.label}</strong>
                  <span>{formatTime(snapshot.timestamp)}</span>
                  <button
                    disabled={restoring !== null}
                    onClick={() => void handleRestore(snapshot.id)}
                    type="button"
                  >
                    {restoring === snapshot.id ? "恢复中……" : "恢复到这里"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
