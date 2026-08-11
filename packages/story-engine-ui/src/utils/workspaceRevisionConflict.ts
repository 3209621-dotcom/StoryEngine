export function reloadAfterWorkspaceRevisionConflict(input: {
  readonly projectPath: string;
  readonly chapter: number;
  readonly revision: number;
  readonly recordRevision: (projectPath: string, chapter: number, revision: number) => void;
  readonly suspend: () => void;
  readonly notify: () => void;
  readonly reload: () => void;
}): void {
  input.recordRevision(input.projectPath, input.chapter, input.revision);
  // 先冻结，确保 reload 触发的 pagehide/beforeunload 不会把冲突的旧内存再次 PUT 回去。
  input.suspend();
  input.notify();
  input.reload();
}
