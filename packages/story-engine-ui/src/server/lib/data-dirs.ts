/**
 * 全局数据目录解析（桌面打包前置·任务①）。
 *
 * 默认路径一律不变（`~/.story-engine` 与 `~/StoryEngine-NG` 经 homedir() 在 Windows 同样成立，
 * 老用户零迁移）；只加 env 覆盖口子供打包壳/测试注入：
 *   - SE_DATA_DIR  → 模型设置/密钥/任务旁路/聊天会话所在目录（默认 ~/.story-engine）
 *   - SE_BOOKS_DIR → 书库根目录（默认 ~/StoryEngine-NG，其下 story-engine/ 放各书）
 *
 * 注意：env 在**每次调用时读取**（不做模块级缓存），保证测试可注入、Electron 主进程后设 env 也生效。
 */
import { homedir } from "node:os";
import { join } from "node:path";

function envDir(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** 全局配置目录：模型设置/密钥/任务旁路/聊天会话。 */
export function resolveGlobalDataDir(): string {
  return resolveGlobalDataDirFor(homedir());
}

/** 同上，但家目录可注入（既有代码/测试沿用 homeDir 参数形态时的适配点）。 */
export function resolveGlobalDataDirFor(homeDir: string): string {
  return envDir("SE_DATA_DIR") ?? join(homeDir, ".story-engine");
}

/** 书库根目录（其下的 story-engine/ 子目录存放各书项目）。 */
export function resolveBooksRootDir(): string {
  return envDir("SE_BOOKS_DIR") ?? join(homedir(), "StoryEngine-NG");
}

/**
 * git 可执行文件解析：SE_GIT_PATH（桌面壳在 Windows 上指向随包携带的 MinGit）→ 系统 "git"。
 * 快照/撤销与健康探针共用这一个口子，别在别处再裸拼 "git"。
 */
export function resolveGitCommand(): string {
  return envDir("SE_GIT_PATH") ?? "git";
}
