import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchJsonError, fetchJson } from "./fetchJson.js";

describe("fetchJson error payload handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves non-ok structured payload reason and nested preflight code", async () => {
    const payload = {
      ok: false,
      reason: "formal_commit_apply_transaction_preflight_failed",
      transactionPreflight: { code: "preview_hash_mismatch" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(payload, 409)));

    let thrown: unknown;
    try {
      await fetchJson("/api/commit/apply", { method: "POST" }, undefined, 0);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("formal_commit_apply_transaction_preflight_failed");
    expect((thrown as Error).message).toContain("preview_hash_mismatch");
    expect((thrown as { readonly payload?: unknown }).payload).toMatchObject(payload);
  });

  it("does not retry POST non-ok responses", async () => {
    const payload = {
      ok: false,
      reason: "formal_commit_apply_finalize_failed",
      transactionFinalized: false,
      finalizeError: "simulated finalize throw",
    };
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length > 1) {
        return jsonResponse({ ok: false, reason: "second_request_should_not_happen" }, 409);
      }
      return jsonResponse(payload, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await fetchJson("/api/commit/apply", { method: "POST" });
    } catch (error) {
      thrown = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thrown).toBeInstanceOf(FetchJsonError);
    expect((thrown as Error).message).toContain("formal_commit_apply_finalize_failed");
    expect((thrown as Error).message).toContain("simulated finalize throw");
    expect((thrown as { readonly payload?: unknown }).payload).toMatchObject(payload);
  });

  it("does not retry POST network TypeError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("/api/commit/apply", { method: "POST" })).rejects.toThrow("network down");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries GET non-ok responses", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return jsonResponse({ ok: false, error: "temporary server error" }, 500);
      }
      return jsonResponse({ ok: true, value: "retried" }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("/api/story", { method: "GET" })).resolves.toEqual({ ok: true, value: "retried" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still retries GET network TypeError", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new TypeError("network down");
      }
      return jsonResponse({ ok: true, value: "retried" }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("/api/story", { method: "GET" })).resolves.toEqual({ ok: true, value: "retried" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
