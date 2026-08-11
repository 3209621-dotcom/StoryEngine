import { rm } from "node:fs/promises";

import { HOME_TEST_TMP_ROOT } from "./server/lib/home-test-tmp.js";

/**
 * 全局清理兜底：整个测试运行开始前、结束后各清一次 home 内测试临时基目录。
 *
 * 为什么需要：临时目录已收敛到 `~/.story-engine-test-tmp` 隐藏基目录（见 home-test-tmp.ts），
 * 但个别路由测试（如 character-matrix-preview / chat-sessions）没有逐个 afterEach 清理自己建的目录，
 * 会在基目录里越堆越多。与其逐个文件补 afterEach、还漏就再堆，不如在这里对「整体安全可删」的
 * 基目录做一次运行级兜底：跑前清掉上次残留、跑完清掉本次产物，保证 home 里零堆积。
 */
export async function setup(): Promise<void> {
  await rm(HOME_TEST_TMP_ROOT, { recursive: true, force: true });
}

export async function teardown(): Promise<void> {
  await rm(HOME_TEST_TMP_ROOT, { recursive: true, force: true });
}
