/**
 * 新书首屏引导（P1-5）：空书落写作台 + 稿纸空态三意图。
 * 纯函数，便于单测；意图走 onSendMessage（唯一控制面）。
 *
 * 「空」= 没有真正文（占位引导稿不算）+ 没有已定稿章。新建书会种占位 draft .md，
 * 必须走 isRealDraftContent，不能只看 wordCount / 非空 trim。
 */
import { isRealDraftContent } from "../../../utils/draftContent.js";

export interface StarterIntent {
  readonly key: string;
  readonly label: string;
  /** 点击后发给右侧 AI 的预置意图（用户面中文）。 */
  readonly intent: string;
}

/** 稿纸空态三个起步意图。 */
export const STARTER_INTENTS: readonly StarterIntent[] = [
  { key: "idea", label: "我有一个点子", intent: "我有一个点子，想跟你聊聊怎么写成故事" },
  { key: "protagonist", label: "帮我理主角", intent: "帮我理一理这本书的主角是谁、性格和目标" },
  { key: "opening", label: "直接写开头", intent: "直接帮我写第一章的开头" },
];

export interface StarterWorkspaceProbe {
  readonly draft: { readonly content: string; readonly wordCount?: number };
  readonly chapters: readonly {
    readonly hasDraftFile?: boolean;
    readonly hasCommittedChapter?: boolean;
  }[];
}

/**
 * 无真正文 / 无正式章节 → 视为「空书首屏」。
 * 占位引导稿（「还没有草稿正文…」）不算真正文；有任一 hasDraftFile（真稿）或已定稿章 → 不再显示引导。
 */
export function isStarterEmptyWorkspace(workspace: StarterWorkspaceProbe): boolean {
  if (isRealDraftContent(workspace.draft.content)) return false;
  return !workspace.chapters.some(
    (chapter) => chapter.hasDraftFile === true || chapter.hasCommittedChapter === true,
  );
}

/** 空书首次进入默认落写作台（非资料中心）。 */
export function defaultCenterViewForWorkspace(
  workspace: StarterWorkspaceProbe,
): "library" | "desk" {
  return isStarterEmptyWorkspace(workspace) ? "desk" : "library";
}
