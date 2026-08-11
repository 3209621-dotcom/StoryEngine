import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog.js";
import type { CreateBookDraft } from "../types.js";
import type { CreateBookResult } from "../api/types.js";

/**
 * 极简「新建书」入口：只问书名（必填）+「创建并开始」。
 * 点创建 → 传仅含 title 的极简 draft 给 onCreate；其余字段全部留空，靠进写作台后的
 * AI 指挥台对话边聊边搭建（题材中立：不预设题材、不做必选下拉，灵感由进台后的
 * 开书开场白「想写个什么样的故事」对话承接）。
 *
 * 替代旧 7 步 CreateBookDialog（已退役删除）。
 */

/** 仅含 title、其余字段全空的极简 draft（题材中立，靠进台后对话搭建）。 */
function minimalDraft(title: string): CreateBookResult {
  return {
    title,
    genre: "", logline: "", readerPromise: "", coreAppeal: "",
    worldPremise: "", coreRules: [], resourceRules: [], socialOrder: [], conflictSources: [], forbiddenWorldRules: [],
    protagonistName: "", protagonistIdentity: "", desire: "", fear: "", weakness: "", behaviorBoundaries: [], knowledgeKnown: [], knowledgeUnknown: [], speechStyle: "",
    initialLocation: "", importantLocations: [], locationRisks: [], initialAssets: [], keyItems: [], resourceLimits: [],
    narrativePerspective: "", proseStyle: [], pacing: "", revealPolicy: "", targetChapterWords: "", forbiddenContent: [], doNotDo: [],
    firstVolumeGoal: "", longFormGoals: [], centralConflicts: [], growthPromise: "",
    firstChapterGoal: "", openingScene: "", firstHook: "", firstConflict: "",
    forbiddenReveals: [], hiddenTruths: [], mustAvoid: [], revealSchedule: [],
  };
}

interface NewBookStarterProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (draft: CreateBookDraft) => Promise<void> | void;
}

export default function NewBookStarter({ open, onCancel, onCreate }: NewBookStarterProps) {
  const [title, setTitle] = useState("");

  if (!open) return null;

  const trimmed = title.trim();
  const canCreate = trimmed.length > 0;

  const close = () => {
    setTitle("");
    onCancel();
  };

  const submit = () => {
    if (!canCreate) return;
    void onCreate(minimalDraft(trimmed));
    setTitle("");
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建书籍</DialogTitle>
          <DialogDescription>
            先取个书名就能开始。进写作台后，AI 会陪你边聊边把主角、世界和第一章搭起来，随时能撤。
          </DialogDescription>
        </DialogHeader>

        <label className="se-v2-new-book-label" htmlFor="new-book-title">书名</label>
        <input
          autoFocus
          className="se-v2-rename-input"
          id="new-book-title"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && canCreate) submit();
          }}
          placeholder="给这本书起个名字…"
          value={title}
        />

        <DialogFooter>
          <button className="se-v2-dialog-cancel-btn" onClick={close} type="button">取消</button>
          <button
            className="se-v2-dialog-confirm-btn"
            disabled={!canCreate}
            onClick={submit}
            type="button"
          >
            创建并开始
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
