import { describe, expect, it, vi } from "vitest";

import { restoreSnapshotSafely } from "./safeSnapshotRestore.js";

describe("restoreSnapshotSafely", () => {
  it("suspends and drains autosave before restore, then reloads without resuming", async () => {
    const events: string[] = [];
    const resumeOnFailure = vi.fn(() => events.push("resume"));

    await restoreSnapshotSafely({
      suspend: () => events.push("suspend"),
      drain: async () => { events.push("drain"); },
      restore: async () => { events.push("restore"); },
      reload: () => events.push("reload"),
      resumeOnFailure,
    });

    expect(events).toEqual(["suspend", "drain", "restore", "reload"]);
    expect(resumeOnFailure).not.toHaveBeenCalled();
  });

  it("resumes autosave only when restore fails and preserves the failure", async () => {
    const events: string[] = [];
    const failure = new Error("restore failed");

    await expect(restoreSnapshotSafely({
      suspend: () => events.push("suspend"),
      drain: async () => { events.push("drain"); },
      restore: async () => {
        events.push("restore");
        throw failure;
      },
      reload: () => events.push("reload"),
      resumeOnFailure: () => events.push("resume"),
    })).rejects.toBe(failure);

    expect(events).toEqual(["suspend", "drain", "restore", "resume"]);
  });
});
