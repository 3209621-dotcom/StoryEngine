/**
 * 测试专用临时目录助手。
 *
 * 为什么不用 os.tmpdir()：`isSafeProjectPath`（见 project-io.ts）要求项目路径落在 $HOME 下，
 * 而 tmpdir() 在 macOS 解析到 /var/folders/...、Linux 到 /tmp(=/private/tmp)，都会被守卫判为
 * 「不安全路径」而返回 400。凡是经 guardProjectPath 的路由测试，其项目目录只能建在 home 内。
 *
 * 为什么要这个助手：过去各测试直接 `mkdtemp(join(homedir(), "..."))`，把几十个临时目录散落在
 * 用户 home 根目录，既污染又不好清理（偶发失败还会漏下空壳）。这里统一收敛到一个隐藏基目录，
 * 既继续满足守卫（仍在 $HOME 下、不落在 UNSAFE 段），又便于一键清理、不再脏 home 根。
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 所有 home 内测试临时目录的统一隐藏基目录，安全可整体删除。 */
export const HOME_TEST_TMP_ROOT = join(homedir(), ".story-engine-test-tmp");

/**
 * 在隐藏基目录下创建一个唯一临时目录并返回其绝对路径。
 * 用法与 `mkdtemp(join(homedir(), prefix))` 等价，但落点收敛、过 guardProjectPath。
 */
export async function makeHomeTempDir(prefix: string): Promise<string> {
  await mkdir(HOME_TEST_TMP_ROOT, { recursive: true });
  return mkdtemp(join(HOME_TEST_TMP_ROOT, prefix));
}
