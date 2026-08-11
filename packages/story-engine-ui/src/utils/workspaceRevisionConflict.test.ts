import { describe, expect, it, vi } from "vitest";
import { reloadAfterWorkspaceRevisionConflict } from "./workspaceRevisionConflict.js";

describe("reloadAfterWorkspaceRevisionConflict", () => {
  it("records disk truth, suspends autosave, notifies, then reloads without attempting another write", () => {
    const events: string[] = [];
    const write = vi.fn();

    reloadAfterWorkspaceRevisionConflict({
      projectPath: "/books/a",
      chapter: 2,
      revision: 9,
      recordRevision: (projectPath, chapter, revision) => events.push(`record:${projectPath}:${chapter}:${revision}`),
      suspend: () => events.push("suspend"),
      notify: () => events.push("notify"),
      reload: () => events.push("reload"),
    });

    expect(events).toEqual(["record:/books/a:2:9", "suspend", "notify", "reload"]);
    expect(write).not.toHaveBeenCalled();
  });
});
