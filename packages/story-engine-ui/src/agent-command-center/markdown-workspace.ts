export type MarkdownWorkspaceDocumentType =
  | "chapter_markdown"
  | "draft_markdown"
  | "outline_markdown"
  | "character_markdown"
  | "world_markdown"
  | "note_markdown"
  | "review_markdown"
  | "quality_report_markdown"
  | "task_log_markdown"
  | "skill_markdown"
  | "constitution_markdown"
  | "unknown_markdown";

export type MarkdownWorkspaceLayer = "markdown_workspace";

export type MarkdownWorkspaceRole =
  | "markdown_chapter"
  | "markdown_draft"
  | "markdown_outline"
  | "markdown_character_doc"
  | "markdown_world_doc"
  | "markdown_note"
  | "markdown_review"
  | "markdown_quality_report"
  | "markdown_task_log"
  | "markdown_skill"
  | "markdown_constitution"
  | "unknown";

export type MarkdownWorkspaceRecommendedPanel =
  | "writing_desk"
  | "draft_panel"
  | "outline_panel"
  | "foundation_panel"
  | "notes_panel"
  | "review_panel"
  | "quality_panel"
  | "task_panel"
  | "skills_panel"
  | "constitution_panel"
  | "unknown_panel";

export interface MarkdownWorkspaceDocumentPolicy {
  readonly documentType: MarkdownWorkspaceDocumentType;
  readonly defaultLayer: MarkdownWorkspaceLayer;
  readonly role: MarkdownWorkspaceRole;
  readonly canAgentRead: boolean;
  readonly canAgentProposeEdit: boolean;
  readonly requiresPatchConfirmation: boolean;
  readonly requiresStrongConfirmation: boolean;
  readonly canDirectlyWriteInV1: boolean;
  readonly canPatchApplyInFuture: boolean;
  readonly recommendedPanel: MarkdownWorkspaceRecommendedPanel;
  readonly defaultContextUse: string;
  readonly notes: readonly string[];
}

const MARKDOWN_DOCUMENT_POLICIES: Record<MarkdownWorkspaceDocumentType, MarkdownWorkspaceDocumentPolicy> = {
  chapter_markdown: {
    documentType: "chapter_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_chapter",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "writing_desk",
    defaultContextUse: "Primary manuscript context for the current or selected chapter.",
    notes: ["Chapter Markdown is creative workspace content.", "Future edits must use patch / diff / confirmation."],
  },
  draft_markdown: {
    documentType: "draft_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_draft",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "draft_panel",
    defaultContextUse: "Draft material that may become manuscript content after review.",
    notes: ["Draft Markdown may receive future patch proposals after user confirmation."],
  },
  outline_markdown: {
    documentType: "outline_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_outline",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "outline_panel",
    defaultContextUse: "Planning context for arcs, chapter order, and intended structure.",
    notes: ["Outline changes can affect later writing and require a visible patch proposal."],
  },
  character_markdown: {
    documentType: "character_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_character_doc",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "foundation_panel",
    defaultContextUse: "Author-visible character reference context.",
    notes: ["Character documents can diverge from JSON state and require explicit confirmation before future patch apply."],
  },
  world_markdown: {
    documentType: "world_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_world_doc",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "foundation_panel",
    defaultContextUse: "Author-visible worldbuilding, rules, and setting context.",
    notes: ["World documents can influence continuity and require explicit confirmation before future patch apply."],
  },
  note_markdown: {
    documentType: "note_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_note",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "notes_panel",
    defaultContextUse: "Working notes, reminders, and author scratch context.",
    notes: ["Notes are workspace material and can become future patch proposals."],
  },
  review_markdown: {
    documentType: "review_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_review",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "review_panel",
    defaultContextUse: "Review findings, editorial feedback, and revision rationale.",
    notes: ["Review documents may be updated through future patch proposals, not direct V1 edits."],
  },
  quality_report_markdown: {
    documentType: "quality_report_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_quality_report",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "quality_panel",
    defaultContextUse: "Quality gate, continuity, and blocking issue records.",
    notes: ["Quality reports remain author-visible workspace records."],
  },
  task_log_markdown: {
    documentType: "task_log_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_task_log",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "task_panel",
    defaultContextUse: "Task-level work logs and operation summaries.",
    notes: ["Task logs should summarize work without replacing memory policy."],
  },
  skill_markdown: {
    documentType: "skill_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_skill",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "skills_panel",
    defaultContextUse: "Skill instructions and reusable writing workflows.",
    notes: ["Skill changes are high-impact workspace changes.", "Future proposals must explain impact before confirmation."],
  },
  constitution_markdown: {
    documentType: "constitution_markdown",
    defaultLayer: "markdown_workspace",
    role: "markdown_constitution",
    canAgentRead: true,
    canAgentProposeEdit: true,
    requiresPatchConfirmation: true,
    requiresStrongConfirmation: true,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: true,
    recommendedPanel: "constitution_panel",
    defaultContextUse: "Project constitution, durable rules, and high-impact constraints.",
    notes: ["Constitution documents require strong confirmation.", "V1 can only propose, never directly modify."],
  },
  unknown_markdown: {
    documentType: "unknown_markdown",
    defaultLayer: "markdown_workspace",
    role: "unknown",
    canAgentRead: false,
    canAgentProposeEdit: false,
    requiresPatchConfirmation: false,
    requiresStrongConfirmation: false,
    canDirectlyWriteInV1: false,
    canPatchApplyInFuture: false,
    recommendedPanel: "unknown_panel",
    defaultContextUse: "Unknown Markdown should not be used until classified.",
    notes: ["Unknown Markdown is blocked by default until a project-level rule classifies it."],
  },
};

const MARKDOWN_DOCUMENT_TYPE_VALUES = new Set<MarkdownWorkspaceDocumentType>(
  Object.keys(MARKDOWN_DOCUMENT_POLICIES) as MarkdownWorkspaceDocumentType[],
);

export function classifyMarkdownDocumentType(path: string): MarkdownWorkspaceDocumentType {
  const normalizedPath = normalizeMarkdownWorkspacePath(path);

  if (!isMarkdown(normalizedPath)) return "unknown_markdown";
  if (matchesPath(normalizedPath, /(^|\/)(chapters|manuscript)\/.+\.md$/i)) return "chapter_markdown";
  if (matchesPath(normalizedPath, /(^|\/)drafts\/.+\.md$/i)) return "draft_markdown";
  if (matchesPath(normalizedPath, /(^|\/)outlines\/.+\.md$/i)) return "outline_markdown";
  if (matchesPath(normalizedPath, /(^|\/)characters\/.+\.md$/i) || matchesPath(normalizedPath, /(^|\/)characters\.md$/i)) {
    return "character_markdown";
  }
  if (matchesPath(normalizedPath, /(^|\/)(world|worldbuilding)\/.+\.md$/i) || matchesPath(normalizedPath, /(^|\/)world\.md$/i)) {
    return "world_markdown";
  }
  if (matchesPath(normalizedPath, /(^|\/)notes\/.+\.md$/i)) return "note_markdown";
  if (matchesPath(normalizedPath, /(^|\/)reviews\/.+\.md$/i)) return "review_markdown";
  if (matchesPath(normalizedPath, /(^|\/)quality-reports\/.+\.md$/i)) return "quality_report_markdown";
  if (matchesPath(normalizedPath, /(^|\/)tasks\/.+\.md$/i)) return "task_log_markdown";
  if (matchesPath(normalizedPath, /(^|\/)skills\/.+\.md$/i)) return "skill_markdown";
  if (matchesPath(normalizedPath, /(^|\/)constitution(\.md|\/.+\.md)$/i)) return "constitution_markdown";

  return "unknown_markdown";
}

export function getMarkdownDocumentPolicy(documentType: MarkdownWorkspaceDocumentType | string): MarkdownWorkspaceDocumentPolicy {
  if (MARKDOWN_DOCUMENT_TYPE_VALUES.has(documentType as MarkdownWorkspaceDocumentType)) {
    return MARKDOWN_DOCUMENT_POLICIES[documentType as MarkdownWorkspaceDocumentType];
  }

  return MARKDOWN_DOCUMENT_POLICIES[classifyMarkdownDocumentType(documentType)];
}

export function canAgentReadMarkdown(path: string): boolean {
  return getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path)).canAgentRead;
}

export function canAgentProposeMarkdownEdit(path: string): boolean {
  return getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path)).canAgentProposeEdit;
}

export function requiresMarkdownPatchConfirmation(path: string): boolean {
  return getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path)).requiresPatchConfirmation;
}

export function requiresMarkdownStrongConfirmation(path: string): boolean {
  return getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path)).requiresStrongConfirmation;
}

export function canDirectlyWriteMarkdownInV1(path: string): boolean {
  return getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path)).canDirectlyWriteInV1;
}

export function canPatchApplyMarkdownInFuture(path: string): boolean {
  return getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path)).canPatchApplyInFuture;
}

export function summarizeMarkdownWorkspacePolicy(path: string): string {
  const policy = getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path));

  return [
    policy.documentType,
    `layer=${policy.defaultLayer}`,
    `role=${policy.role}`,
    `proposeEdit=${String(policy.canAgentProposeEdit)}`,
    `patchConfirmation=${String(policy.requiresPatchConfirmation)}`,
    `strongConfirmation=${String(policy.requiresStrongConfirmation)}`,
    `directWriteV1=${String(policy.canDirectlyWriteInV1)}`,
    `futurePatch=${String(policy.canPatchApplyInFuture)}`,
  ].join("; ");
}

function normalizeMarkdownWorkspacePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/^\/+/, "").toLowerCase();
}

function isMarkdown(path: string): boolean {
  return path.endsWith(".md");
}

function matchesPath(path: string, pattern: RegExp): boolean {
  return pattern.test(path);
}
