import { describe, expect, it } from "vitest";

import { createDraftSaveRaceGuard } from "./draftSaveRaceGuard.js";

describe("createDraftSaveRaceGuard", () => {
  it("coalesces overlapping save requests and runs one latest follow-up save", async () => {
    const guard = createDraftSaveRaceGuard();
    const events: string[] = [];
    let resolveFirst: (() => void) | undefined;

    const first = guard.run(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      events.push("first:end");
    });
    const second = guard.run(async () => {
      events.push("second:start");
      events.push("second:end");
    });
    const third = guard.run(async () => {
      events.push("third:start");
      events.push("third:end");
    });

    expect(events).toEqual(["first:start"]);
    resolveFirst?.();
    await Promise.all([first, second, third]);

    expect(events).toEqual(["first:start", "first:end", "third:start", "third:end"]);
    expect(guard.isRunning).toBe(false);
  });

  it("keeps overlapping run promises pending until the latest pending save finishes", async () => {
    const guard = createDraftSaveRaceGuard();
    const events: string[] = [];
    const firstDeferred = createDeferred();
    const thirdDeferred = createDeferred();
    let secondSettled = false;
    let thirdSettled = false;

    const first = guard.run(async () => {
      events.push("first:start");
      await firstDeferred.promise;
      events.push("first:end");
    });
    const second = guard.run(async () => {
      events.push("second:start");
      events.push("second:end");
    });
    const third = guard.run(async () => {
      events.push("third:start");
      await thirdDeferred.promise;
      events.push("third:end");
    });

    void second.then(() => {
      secondSettled = true;
    });
    void third.then(() => {
      thirdSettled = true;
    });

    await flushAsyncTurn();

    expect(events).toEqual(["first:start"]);
    expect(guard.isRunning).toBe(true);
    expect(secondSettled).toBe(false);
    expect(thirdSettled).toBe(false);

    firstDeferred.resolve();
    await flushAsyncTurn();

    expect(events).toEqual(["first:start", "first:end", "third:start"]);
    expect(guard.isRunning).toBe(true);
    expect(secondSettled).toBe(false);
    expect(thirdSettled).toBe(false);

    thirdDeferred.resolve();
    await Promise.all([first, second, third]);

    expect(events).toEqual(["first:start", "first:end", "third:start", "third:end"]);
    expect(secondSettled).toBe(true);
    expect(thirdSettled).toBe(true);
    expect(guard.isRunning).toBe(false);
  });

  it("rejects overlapping run promises when the latest pending save fails", async () => {
    const guard = createDraftSaveRaceGuard();
    const firstDeferred = createDeferred();
    const failure = new Error("latest save failed");

    const first = guard.run(async () => {
      await firstDeferred.promise;
    });
    const second = guard.run(async () => undefined);
    const third = guard.run(async () => {
      throw failure;
    });

    firstDeferred.resolve();

    await expect(first).rejects.toThrow("latest save failed");
    await expect(second).rejects.toThrow("latest save failed");
    await expect(third).rejects.toThrow("latest save failed");
    expect(guard.isRunning).toBe(false);
  });
});

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

async function flushAsyncTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
