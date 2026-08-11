import type { SaveChapterWorkspaceRequest } from "../api/types.js";
import { isRealDraftContent } from "./draftContent.js";

export interface WorkspaceAutosaveRequestInput
  extends Omit<SaveChapterWorkspaceRequest, "draftContent" | "draftTitle" | "writeDraftFile"> {
  readonly content?: string;
  readonly title?: string;
  readonly suppressed?: boolean;
  readonly committed?: boolean;
}

/** Build an autosave payload that can never persist empty or placeholder editor content. */
export function buildWorkspaceAutosaveRequest(
  input: WorkspaceAutosaveRequestInput,
): SaveChapterWorkspaceRequest {
  const {
    content,
    title,
    suppressed = false,
    committed = false,
    ...request
  } = input;
  const canWriteDraft = isRealDraftContent(content) && !suppressed && !committed;

  return {
    ...request,
    ...(canWriteDraft
      ? {
        draftContent: content,
        draftTitle: title,
        writeDraftFile: true,
      }
      : {}),
  };
}
