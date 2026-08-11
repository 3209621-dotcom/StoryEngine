import { beforeEach, describe, expect, it } from "vitest";
import {
  prepareVersionedWorkspaceSave,
  recordWorkspaceRevision,
  resetWorkspaceRevisionTrackerForTests,
} from "./workspaceRevisionTracker.js";
import { __resetAutosaveControlForTest, scheduleAutosave } from "./autosaveControl.js";

describe("workspaceRevisionTracker", () => {
  beforeEach(() => {
    resetWorkspaceRevisionTrackerForTests();
    __resetAutosaveControlForTest();
  });

  it("rebases a queued same-chapter save on the revision returned by the preceding save", () => {
    recordWorkspaceRevision("/books/a", 1, 5);
    const first = prepareVersionedWorkspaceSave({
      projectPath: "/books/a",
      chapter: 1,
      selectedAdviceCardKeys: [],
      draftContent: "first",
    });
    expect(first.expectedRevision).toBe(5);

    // 第一笔响应 revision=6 后，尚未实际发送的第二笔必须用 6，不能自撞 409。
    recordWorkspaceRevision("/books/a", 1, 6);
    const second = prepareVersionedWorkspaceSave({
      projectPath: "/books/a",
      chapter: 1,
      selectedAdviceCardKeys: [],
      draftContent: "latest",
    });
    expect(second.expectedRevision).toBe(6);
    expect(second.draftContent).toBe("latest");
  });

  it("keeps revisions isolated by project and chapter", () => {
    recordWorkspaceRevision("/books/a", 1, 2);
    recordWorkspaceRevision("/books/a", 2, 8);
    recordWorkspaceRevision("/books/b", 1, 13);

    expect(prepareVersionedWorkspaceSave({ projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [] }).expectedRevision).toBe(2);
    expect(prepareVersionedWorkspaceSave({ projectPath: "/books/a", chapter: 2, selectedAdviceCardKeys: [] }).expectedRevision).toBe(8);
    expect(prepareVersionedWorkspaceSave({ projectPath: "/books/b", chapter: 1, selectedAdviceCardKeys: [] }).expectedRevision).toBe(13);
  });

  it("serializes two rapid same-key saves without the second request self-conflicting", async () => {
    recordWorkspaceRevision("/books/a", 1, 5);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sentRevisions: number[] = [];
    let onDisk = "";
    const first = scheduleAutosave("/books/a::1", async () => {
      const request = prepareVersionedWorkspaceSave({
        projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [], draftContent: "first",
      });
      sentRevisions.push(request.expectedRevision!);
      await firstGate;
      onDisk = request.draftContent!;
      recordWorkspaceRevision("/books/a", 1, 6);
    });
    const second = scheduleAutosave("/books/a::1", async () => {
      const request = prepareVersionedWorkspaceSave({
        projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [], draftContent: "latest",
      });
      sentRevisions.push(request.expectedRevision!);
      onDisk = request.draftContent!;
      recordWorkspaceRevision("/books/a", 1, 7);
    });

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(sentRevisions).toEqual([5, 6]);
    expect(onDisk).toBe("latest");
  });
});
