// @vitest-environment node
//
// 阶段0 验证：那套后端能脱离 Vite、在独立 connect+http server 上跑起来。
// 起一个真实 server（端口 0 随机），打 /api 路由应拿到 JSON（路由中间件生效、没掉进静态兜底），
// 打任意非 /api 路径应拿到 dist 的 index.html（sirv SPA fallback 生效）。
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStandaloneServer, type StandaloneServerHandle } from "./standalone-entry.js";

const SENTINEL = "STANDALONE-DIST-OK";
let handle: StandaloneServerHandle;

beforeAll(async () => {
  const distDir = await mkdtemp(join(tmpdir(), "se-standalone-dist-"));
  await writeFile(join(distDir, "index.html"), `<!doctype html><title>${SENTINEL}</title>`, "utf-8");
  handle = await createStandaloneServer({ distDir, port: 0 });
});

afterAll(async () => {
  await handle?.close();
});

describe("createStandaloneServer（后端脱离 Vite 独立跑）", () => {
  it("分配到真实端口、url 指向本机", () => {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/`);
  });

  it("/api 路由生效：返回 dev-api 统一的 JSON（不掉进静态兜底）", async () => {
    const res = await fetch(`${handle.url}api/state-overview?project=${encodeURIComponent("/no/such/project")}`);
    const text = await res.text();
    expect(text).not.toContain(SENTINEL); // 没被 SPA fallback 接走
    const parsed = JSON.parse(text); // 是 JSON（API 中间件确实跑了）
    expect(parsed).toHaveProperty("ok"); // dev-api 路由统一 { ok, ... } 形态
  });

  it("静态 + SPA fallback 生效：任意路径回退 dist/index.html", async () => {
    const res = await fetch(`${handle.url}some/spa/deep/route`);
    expect(await res.text()).toContain(SENTINEL);
  });
});
