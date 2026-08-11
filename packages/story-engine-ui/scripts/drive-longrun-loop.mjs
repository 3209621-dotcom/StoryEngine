#!/usr/bin/env node
/**
 * 真机长跑循环：用 agent-drive.mjs 逐章驱动 agent（SSE 真调模型）。
 *
 * 用法：
 *   node scripts/drive-longrun-loop.mjs \
 *     --book=/path/to/book \
 *     --from=5 --to=10 \
 *     --logDir=/tmp/storyengine-longrun-xxx
 *
 * 断点续跑：已落盘 chapters/NNNN.md 的章自动跳过；有草稿无入库则只跑入库。
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DRIVE = join(__dirname, "agent-drive.mjs");
const BASE = process.env.STORY_ENGINE_BASE || "http://127.0.0.1:5188";

function parseArgs(argv) {
  const out = {
    book: process.env.STORY_ENGINE_PROJECT || "/Users/author/story-engine/longrun-chapterdelta-20260704",
    from: 5,
    to: 10,
    logDir: `/tmp/storyengine-longrun-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    pauseSec: 10,
  };
  for (const arg of argv) {
    if (arg.startsWith("--book=")) out.book = arg.slice(7);
    else if (arg.startsWith("--from=")) out.from = Number(arg.slice(7));
    else if (arg.startsWith("--to=")) out.to = Number(arg.slice(5));
    else if (arg.startsWith("--logDir=")) out.logDir = arg.slice(9);
    else if (arg.startsWith("--pauseSec=")) out.pauseSec = Number(arg.slice(11));
  }
  return out;
}

function chapterFile(book, n) {
  return join(book, "chapters", `${String(n).padStart(4, "0")}.md`);
}

function draftFile(book, n) {
  return join(book, "drafts", "fast", `chapter-${String(n).padStart(4, "0")}.md`);
}

function runAgentDrive({ msg, chapter, historyFile, book, logPath }) {
  return new Promise((resolve, reject) => {
    const args = [AGENT_DRIVE, msg, String(chapter), historyFile, book];
    const child = spawn(process.execPath, args, {
      env: { ...process.env, STORY_ENGINE_BASE: BASE, STORY_ENGINE_PROJECT: book },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; process.stdout.write(d); });
    child.stderr.on("data", (d) => { stderr += d; process.stderr.write(d); });
    child.on("close", async (code) => {
      const block = `\n===== ${new Date().toISOString()} ch${chapter} =====\n用户：${msg}\ncode=${code}\n${stdout}\n${stderr}\n`;
      await appendFile(logPath, block, "utf-8");
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`agent-drive exit ${code} for ch${chapter}`));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function snapshotStatus(book, logDir) {
  const { readdir, readFile: rf } = await import("node:fs/promises");
  const chapters = (await readdir(join(book, "chapters")).catch(() => []))
    .filter((f) => /^\d{4}\.md$/.test(f))
    .sort();
  let threads = 0;
  let hooks = 0;
  try {
    const t = JSON.parse(await rf(join(book, "story", "threads.json"), "utf-8"));
    threads = Array.isArray(t.threads) ? t.threads.length : (Array.isArray(t) ? t.length : 0);
  } catch { /* ignore */ }
  try {
    const h = JSON.parse(await rf(join(book, "story", "hooks.json"), "utf-8"));
    hooks = Array.isArray(h.hooks) ? h.hooks.length : 0;
  } catch { /* ignore */ }
  const snap = { at: new Date().toISOString(), chapters: chapters.length, chapterFiles: chapters, threads, hooks };
  await writeFile(join(logDir, "status.json"), JSON.stringify(snap, null, 2), "utf-8");
  console.log(`\n📊 状态：${chapters.length} 章落盘 | threads=${threads} hooks=${hooks}`);
  return snap;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  await mkdir(cfg.logDir, { recursive: true });
  const historyFile = join(cfg.logDir, "history.json");
  const logPath = join(cfg.logDir, "run.log");
  const meta = { ...cfg, startedAt: new Date().toISOString(), base: BASE };
  await writeFile(join(cfg.logDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

  console.log(`\n🚀 长跑开始 book=${cfg.book} ch${cfg.from}→${cfg.to} log=${cfg.logDir}`);

  for (let ch = cfg.from; ch <= cfg.to; ch += 1) {
    if (existsSync(chapterFile(cfg.book, ch))) {
      console.log(`\n⏭  第 ${ch} 章已入库，跳过`);
      await snapshotStatus(cfg.book, cfg.logDir);
      continue;
    }

    const hasDraft = existsSync(draftFile(cfg.book, ch));
    try {
      if (!hasDraft) {
        console.log(`\n📝 第 ${ch} 章：生成草稿…`);
        await runAgentDrive({
          msg: `继续写第${ch}章正文。只写这一章，不要写其他章。`,
          chapter: ch,
          historyFile,
          book: cfg.book,
          logPath,
        });
        await sleep(cfg.pauseSec * 1000);
      } else {
        console.log(`\n📄 第 ${ch} 章：草稿已存在，跳过生成`);
      }

      console.log(`\n💾 第 ${ch} 章：预览并正式入库…`);
      await runAgentDrive({
        msg: `把第${ch}章草稿走完预览并正式入库。`,
        chapter: ch,
        historyFile,
        book: cfg.book,
        logPath,
      });

      if (!existsSync(chapterFile(cfg.book, ch))) {
        console.warn(`\n⚠️  第 ${ch} 章入库后磁盘仍无 chapters 文件，再试一次入库…`);
        await sleep(cfg.pauseSec * 1000);
        const retry = await runAgentDrive({
          msg: `正式入库第${ch}章。`,
          chapter: ch,
          historyFile,
          book: cfg.book,
          logPath,
        });
        // r8 止损：重试后仍缺章 → 硬停（fail json + exit 1），绝不带着缺章推进下一章
        // （100ch 收官实锤：ch88 缺失后若继续，ch89+ 全部建立在错误状态上、白烧模型费）。
        if (!existsSync(chapterFile(cfg.book, ch))) {
          const tail = retry.stdout.trim().slice(-400);
          throw new Error(`第 ${ch} 章重试入库后磁盘仍无章节文件——停止推进，人工检查。最后输出尾部：${tail}`);
        }
      }
    } catch (err) {
      const fail = { chapter: ch, error: String(err?.message ?? err), at: new Date().toISOString() };
      await writeFile(join(cfg.logDir, `fail-ch${String(ch).padStart(2, "0")}.json`), JSON.stringify(fail, null, 2));
      console.error(`\n❌ 第 ${ch} 章失败：`, fail.error);
      await snapshotStatus(cfg.book, cfg.logDir);
      process.exit(1);
    }

    await snapshotStatus(cfg.book, cfg.logDir);
    if (ch < cfg.to) await sleep(cfg.pauseSec * 1000);
  }

  meta.finishedAt = new Date().toISOString();
  await writeFile(join(cfg.logDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  console.log(`\n✅ 长跑完成 ch${cfg.from}→${cfg.to}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
