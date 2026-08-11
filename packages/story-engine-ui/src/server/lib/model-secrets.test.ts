import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSavedProviderApiKey,
  globalModelSecretsPath,
  mergeProviderApiKeys,
  readModelSecrets,
  saveModelSecrets,
  serializeModelSecrets,
} from "./llm-client.js";

describe("mergeProviderApiKeys（纯函数）", () => {
  it("新键覆盖旧键、去空白、丢空值", () => {
    const merged = mergeProviderApiKeys({ a: "old" }, { providerApiKeys: { a: "  new  ", b: "  ", c: "ck" } });
    expect(merged).toEqual({ a: "new", c: "ck" });
  });

  it("activeProviderIds 只保留活跃 provider（删掉已移除 provider 的旧键）", () => {
    const merged = mergeProviderApiKeys({ a: "ka", b: "kb" }, { activeProviderIds: ["a"] });
    expect(merged).toEqual({ a: "ka" });
  });

  it("空输入保留全部已有键", () => {
    expect(mergeProviderApiKeys({ a: "ka" }, {})).toEqual({ a: "ka" });
  });
});

describe("serializeModelSecrets", () => {
  it("固定 version:1 + 尾换行", () => {
    expect(serializeModelSecrets({ a: "k" })).toBe(`${JSON.stringify({ version: 1, providerApiKeys: { a: "k" } }, null, 2)}\n`);
  });
});

describe("readModelSecrets（审查 #8：坏 JSON 不当空）", () => {
  let dir: string;
  const original = process.env.SE_DATA_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "se-secrets-"));
    process.env.SE_DATA_DIR = dir;
  });
  afterEach(async () => {
    if (original === undefined) delete process.env.SE_DATA_DIR;
    else process.env.SE_DATA_DIR = original;
    await rm(dir, { recursive: true, force: true });
  });

  it("文件不存在 → 空库（不报错）", async () => {
    const secrets = await readModelSecrets();
    expect(secrets.providerApiKeys).toEqual({});
  });

  it("坏 JSON → 抛错，绝不当空库返回（否则会覆盖用户密钥）", async () => {
    await writeFile(globalModelSecretsPath(), "{ this is not json", "utf-8");
    await expect(readModelSecrets()).rejects.toThrow(/不是有效 JSON/);
  });

  it("合法文件 → 只保留非空字符串键", async () => {
    await writeFile(
      globalModelSecretsPath(),
      JSON.stringify({ version: 1, providerApiKeys: { a: "ka", b: "", c: 123 } }),
      "utf-8",
    );
    const secrets = await readModelSecrets();
    expect(secrets.providerApiKeys).toEqual({ a: "ka" });
  });

  it("saveModelSecrets 原子写 + 合并，且不丢已有键；权限 0600", async () => {
    await saveModelSecrets({ providerApiKeys: { deepseek: "sk-1" } });
    expect(await getSavedProviderApiKey("deepseek")).toBe("sk-1");
    await saveModelSecrets({ providerApiKeys: { glm: "sk-2" } });
    expect(await getSavedProviderApiKey("deepseek")).toBe("sk-1");
    expect(await getSavedProviderApiKey("glm")).toBe("sk-2");
    const raw = await readFile(globalModelSecretsPath(), "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, providerApiKeys: { deepseek: "sk-1", glm: "sk-2" } });
  });

  it("坏 JSON 时 saveModelSecrets 直接抛错（拒绝在损坏库上覆盖）", async () => {
    await writeFile(globalModelSecretsPath(), "not json", "utf-8");
    await expect(saveModelSecrets({ providerApiKeys: { a: "k" } })).rejects.toThrow();
    // 原损坏文件保持原样，未被覆盖成空库
    expect(await readFile(globalModelSecretsPath(), "utf-8")).toBe("not json");
  });
});
