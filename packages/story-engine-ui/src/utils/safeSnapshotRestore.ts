export interface SafeSnapshotRestoreInput {
  readonly suspend: () => void;
  readonly drain: () => Promise<unknown>;
  readonly restore: () => Promise<unknown>;
  readonly reload: () => void;
  readonly resumeOnFailure: () => void;
}

/** Keep autosave frozen from the restore barrier until the page reloads. */
export async function restoreSnapshotSafely(input: SafeSnapshotRestoreInput): Promise<void> {
  input.suspend();
  try {
    await input.drain();
    await input.restore();
    input.reload();
  } catch (error) {
    input.resumeOnFailure();
    throw error;
  }
}
