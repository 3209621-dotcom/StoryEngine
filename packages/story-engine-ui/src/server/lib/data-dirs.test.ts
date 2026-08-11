// @vitest-environment node
//
// 桌面前置·任务①：数据目录 env 覆盖（默认路径不变、老用户零迁移）+ Windows 路径安全。
import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveBooksRootDir, resolveGitCommand, resolveGlobalDataDir, resolveGlobalDataDirFor } from "./data-dirs.js";
import { isSafeProjectPathForPlatform } from "./project-io.js";
import { taskAssignmentsPath } from "./task-assignments.js";

const ORIGINAL_DATA_DIR = process.env.SE_DATA_DIR;
const ORIGINAL_BOOKS_DIR = process.env.SE_BOOKS_DIR;
const ORIGINAL_GIT_PATH = process.env.SE_GIT_PATH;

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.SE_DATA_DIR;
  else process.env.SE_DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_BOOKS_DIR === undefined) delete process.env.SE_BOOKS_DIR;
  else process.env.SE_BOOKS_DIR = ORIGINAL_BOOKS_DIR;
  if (ORIGINAL_GIT_PATH === undefined) delete process.env.SE_GIT_PATH;
  else process.env.SE_GIT_PATH = ORIGINAL_GIT_PATH;
});

describe("resolveGlobalDataDir / resolveBooksRootDir（SE_DATA_DIR / SE_BOOKS_DIR 覆盖）", () => {
  it("无 env → 默认 ~/.story-engine 与 ~/StoryEngine-NG（向后兼容，老用户零迁移）", () => {
    delete process.env.SE_DATA_DIR;
    delete process.env.SE_BOOKS_DIR;
    expect(resolveGlobalDataDir()).toBe(join(homedir(), ".story-engine"));
    expect(resolveBooksRootDir()).toBe(join(homedir(), "StoryEngine-NG"));
  });

  it("设了 env → 用 env（每次调用现读，后设也生效）", () => {
    process.env.SE_DATA_DIR = "/tmp/se-test-data";
    process.env.SE_BOOKS_DIR = "/tmp/se-test-books";
    expect(resolveGlobalDataDir()).toBe("/tmp/se-test-data");
    expect(resolveBooksRootDir()).toBe("/tmp/se-test-books");
  });

  it("空串/空白 env 视同未设（模型可能传退化值的同款防御姿势）", () => {
    process.env.SE_DATA_DIR = "   ";
    expect(resolveGlobalDataDir()).toBe(join(homedir(), ".story-engine"));
  });

  it("resolveGitCommand：SE_GIT_PATH（桌面壳随包 MinGit）→ 系统 git", () => {
    delete process.env.SE_GIT_PATH;
    expect(resolveGitCommand()).toBe("git");
    process.env.SE_GIT_PATH = "C:\\apps\\StoryEngine\\resources\\app\\vendor\\mingit\\cmd\\git.exe";
    expect(resolveGitCommand()).toBe("C:\\apps\\StoryEngine\\resources\\app\\vendor\\mingit\\cmd\\git.exe");
    process.env.SE_GIT_PATH = "  ";
    expect(resolveGitCommand()).toBe("git");
  });

  it("task-assignments 路径跟随 env；无 env 时沿用传入 homeDir（既有测试形态不变）", () => {
    delete process.env.SE_DATA_DIR;
    expect(taskAssignmentsPath("/Users/tester")).toBe("/Users/tester/.story-engine/task-assignments.json");
    process.env.SE_DATA_DIR = "/tmp/se-test-data";
    expect(taskAssignmentsPath("/Users/tester")).toBe("/tmp/se-test-data/task-assignments.json");
    expect(resolveGlobalDataDirFor("/Users/tester")).toBe("/tmp/se-test-data");
  });
});

describe("isSafeProjectPathForPlatform win32 分支（桌面前置：原实现纯 POSIX、Windows 上全拒）", () => {
  const HOME = "C:\\Users\\tester";

  it("家目录下的书路径 → 放行（含大小写差异）", () => {
    expect(isSafeProjectPathForPlatform("C:\\Users\\tester\\StoryEngine-NG\\story-engine\\book-1", "win32", HOME)).toBe(true);
    expect(isSafeProjectPathForPlatform("c:\\users\\TESTER\\StoryEngine-NG\\book", "win32", HOME)).toBe(true);
  });

  it("系统目录 → 拒（Windows / Program Files / ProgramData，大小写不敏感）", () => {
    expect(isSafeProjectPathForPlatform("C:\\Windows\\System32", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("C:\\Program Files\\App", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("C:\\Program Files (x86)\\App", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("c:\\programdata\\x", "win32", HOME)).toBe(false);
  });

  it("家目录外 / 家目录本身 / 敏感段（AppData/.ssh）→ 拒", () => {
    expect(isSafeProjectPathForPlatform("D:\\Books\\novel", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("C:\\Users\\tester", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("C:\\Users\\tester\\AppData\\Roaming\\x", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("C:\\Users\\tester\\.ssh\\keys", "win32", HOME)).toBe(false);
  });

  it("相对路径 / 穿越 → 拒（resolve 后仍须在家目录下）", () => {
    expect(isSafeProjectPathForPlatform("StoryEngine-NG\\book", "win32", HOME)).toBe(false);
    expect(isSafeProjectPathForPlatform("C:\\Users\\tester\\books\\..\\..\\other\\x", "win32", HOME)).toBe(false);
  });

  it("POSIX 分支行为不变（回归锚）", () => {
    const home = "/Users/tester";
    expect(isSafeProjectPathForPlatform("/Users/tester/StoryEngine-NG/story-engine/book", "darwin", home)).toBe(true);
    expect(isSafeProjectPathForPlatform("/etc/passwd", "darwin", home)).toBe(false);
    expect(isSafeProjectPathForPlatform("/Users/tester/.ssh/x", "darwin", home)).toBe(false);
  });
});
