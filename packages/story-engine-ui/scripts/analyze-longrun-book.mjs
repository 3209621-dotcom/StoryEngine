#!/usr/bin/env node
/**
 * 分析长跑测试书，输出 Markdown 报告到 stdout 或 --out= 文件。
 *
 * r7 重写（2026-07-05）：
 * - mainEvent 判据改三态（✅/⚠️需肉眼/❌），修掉旧版「≥15 字 + 弱对白正则」把观察句/引用句谎报 ✅ 的问题
 *   （75 章真机：ch38/39 观察句、ch18=ch19 跨章重复 mainEvent 都被旧判据标 ✅）。⚠️ 三态仍是启发式，
 *   ✅ 只代表「没触发任何嫌疑规则」，正式 verdict 必须肉眼抽查。
 * - 新增：目标健康表（idle 一目了然）、线索池状态分布 + 最旧 open lead + 每章新开数、
 *   gained/lost 覆盖（修正「resourceDeltas 全没进时间线」的误诊口径——它在 semanticSummary.gained/lost）、
 *   stale 提醒量（本章提醒数 vs 全量底数，验证 r7 里程碑制降噪）。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

function parseArgs(argv) {
  const out = { book: "", out: "" };
  for (const arg of argv) {
    if (arg.startsWith("--book=")) out.book = arg.slice(7);
    else if (arg.startsWith("--out=")) out.out = arg.slice(6);
  }
  if (!out.book) throw new Error("需要 --book=/path/to/book");
  return out;
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf-8")); } catch { return fallback; }
}

const norm = (s) => String(s ?? "").replace(/[\s\u3000]+/g, "");

// ---- mainEvent 三态判据（按 75 章真机病例校准：ch4 对白无引号 / ch5 环境句 / ch18=19 跨章重复句 / ch38 观察句） ----
const OBSERVATION_OPENING = /^[^，。！？]{0,8}(?:看见|望着|盯着|注意到|听见|站在|蹲在|坐在|躺在|凑近|观察|回头|抬头|低头)/u;
const DIALOGUE_MARKS = /[「」『』“”]/u;
const SECOND_PERSON = /你们?/u;

function splitSentences(text) {
  return String(text ?? "")
    .split(/[。！？!?]/u)
    .map(norm)
    .filter((s) => s.length >= 10);
}

function judgeMainEvent(main, { duplicateSentences, characterNames }) {
  const t = String(main ?? "").trim();
  if (!t || t === "—") return { grade: "❌", reason: "缺失" };
  if (t.length < 12) return { grade: "❌", reason: `过短（${t.length} 字）` };
  if (/^[「『“]/u.test(t)) return { grade: "❌", reason: "引号开头（疑似对白）" };
  if (splitSentences(t).some((s) => duplicateSentences.has(s))) {
    return { grade: "❌", reason: "含跨章重复句（修复前正则残留特征）" };
  }
  if (DIALOGUE_MARKS.test(t)) return { grade: "⚠️", reason: "含对白引号，需肉眼" };
  if (SECOND_PERSON.test(t)) return { grade: "⚠️", reason: "含第二人称，疑对白句被当事件" };
  if (/^(?:明天|明日|后天|待会|回头|等到|要是|如果|一旦)/u.test(t)) {
    return { grade: "⚠️", reason: "预期/假设句开头，疑内心戏被当事件" };
  }
  if (characterNames.length > 0 && !characterNames.some((name) => t.includes(name))) {
    return { grade: "⚠️", reason: "无具体人物主语，疑环境/细节句" };
  }
  if (OBSERVATION_OPENING.test(t)) return { grade: "⚠️", reason: "观察句式开头，需肉眼" };
  if (/^(他|她|你|我)[^，。]{0,10}[。！？]?$/u.test(t)) return { grade: "❌", reason: "代词短句碎片" };
  return { grade: "✅", reason: "" };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const book = cfg.book;
  const chapterFiles = (await readdir(join(book, "chapters")).catch(() => []))
    .filter((f) => /^\d{4}\.md$/.test(f))
    .map((f) => Number(f.slice(0, 4)))
    .sort((a, b) => a - b);
  const maxChapter = chapterFiles.at(-1) ?? 0;

  const events = await readJson(join(book, "timeline", "events.json"), []);
  const eventList = Array.isArray(events) ? events : (events?.events ?? []);
  const threadsRaw = await readJson(join(book, "story", "threads.json"), {});
  const hooksRaw = await readJson(join(book, "story", "hooks.json"), {});
  const goalsRaw = await readJson(join(book, "story", "arc-goals.json"), {});
  const threads = Array.isArray(threadsRaw.threads) ? threadsRaw.threads : (Array.isArray(threadsRaw) ? threadsRaw : []);
  const hooks = Array.isArray(hooksRaw.hooks) ? hooksRaw.hooks : [];
  const goals = Array.isArray(goalsRaw.goals) ? goalsRaw.goals : (Array.isArray(goalsRaw) ? goalsRaw : []);

  const lines = [];
  lines.push(`# StoryEngine 长跑分析报告`);
  lines.push(`- 书：\`${book}\``);
  lines.push(`- 分析时间：${new Date().toISOString()}`);
  lines.push(`- 落盘章数：${chapterFiles.length}（最新第 ${maxChapter} 章）`);
  lines.push(`- threads：${threads.length} 条 | hooks：${hooks.length} 条 | arc goals：${goals.length} 条`);
  lines.push("");

  // ---- 逐章 mainEvent（三态） ----
  lines.push("## 逐章 mainEvent（三态判据：✅ 无嫌疑 / ⚠️ 需肉眼 / ❌ 断片；✅ 仅代表没触发嫌疑规则，正式 verdict 仍须抽查）");
  lines.push("");
  lines.push("| 章 | mainEvent | 判定 | 说明 |");
  lines.push("|---:|---|---|---|");
  const semByChapter = new Map();
  for (const ev of eventList) {
    const sem = ev?.effects?.semanticSummary;
    if (sem && !semByChapter.has(ev.chapter)) semByChapter.set(ev.chapter, sem);
  }
  // 跨章重复【句】检测（ch18/ch19 共用同一句「袖口蹭到腕上的血痕…」——整条不同但句子复用，静默烂典型）
  const sentenceCounts = new Map();
  for (const ch of chapterFiles) {
    const seen = new Set();
    for (const s of splitSentences(semByChapter.get(ch)?.mainEvent ?? "")) {
      if (seen.has(s)) continue;
      seen.add(s);
      sentenceCounts.set(s, (sentenceCounts.get(s) ?? 0) + 1);
    }
  }
  const duplicateSentences = new Set([...sentenceCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  // 人物名主语参考集：presentCharacterNames / mentionedCharacterNames 全书聚合（题材中立，来自书本身）。
  const characterNames = [...new Set(
    [...semByChapter.values()].flatMap((sem) => [
      ...(sem.presentCharacterNames ?? []),
      ...(sem.mentionedCharacterNames ?? []),
    ]).filter((name) => typeof name === "string" && name.length >= 2),
  )];
  const gradeStat = { "✅": 0, "⚠️": 0, "❌": 0 };
  for (const ch of chapterFiles) {
    const main = semByChapter.get(ch)?.mainEvent ?? "—";
    const { grade, reason } = judgeMainEvent(main, { duplicateSentences, characterNames });
    gradeStat[grade] += 1;
    const shown = String(main).slice(0, 60) + (String(main).length > 60 ? "…" : "");
    lines.push(`| ${ch} | ${shown} | ${grade} | ${reason || "—"} |`);
  }
  lines.push("");
  lines.push(`**统计**：✅ ${gradeStat["✅"]} / ⚠️ ${gradeStat["⚠️"]} / ❌ ${gradeStat["❌"]}（共 ${chapterFiles.length} 章）`);
  lines.push("");

  // ---- 目标健康 ----
  lines.push("## 主线/阶段目标健康（idle = 最新章 - lastTouched；main_arc 永不自动蛰伏、mini 连续 15 章不动会转 stale）");
  lines.push("");
  lines.push("| 目标 | scope | status | first | last | idle |");
  lines.push("|---|---|---|---:|---:|---:|");
  for (const goal of [...goals].sort((a, b) => (b.lastTouchedChapter ?? 0) - (a.lastTouchedChapter ?? 0))) {
    const idle = goal.status === "completed" ? "—" : String(maxChapter - (goal.lastTouchedChapter ?? 0));
    lines.push(`| ${String(goal.title ?? "").slice(0, 30)} | ${goal.scope ?? "?"} | ${goal.status ?? "?"} | ${goal.firstSeenChapter ?? "?"} | ${goal.lastTouchedChapter ?? "?"} | ${idle} |`);
  }
  const idleMain = goals.filter((g) => g.scope === "main_arc" && g.status !== "completed" && maxChapter - (g.lastTouchedChapter ?? 0) > 10);
  if (idleMain.length > 0) {
    lines.push("");
    lines.push(`⚠️ **主线停滞**：${idleMain.map((g) => `「${g.title}」已 ${maxChapter - g.lastTouchedChapter} 章未推进`).join("；")}——主线不该长期停摆。`);
  }
  lines.push("");

  // ---- 线索池 ----
  lines.push("## 线索池");
  lines.push("");
  const stat = {};
  for (const t of threads) {
    const key = `${t.type}/${t.status}`;
    stat[key] = (stat[key] ?? 0) + 1;
  }
  lines.push(`- 状态分布：${Object.entries(stat).sort().map(([k, v]) => `${k}=${v}`).join(" | ")}`);
  const openLeads = threads
    .filter((t) => t.type === "lead" && (t.status === "open" || t.status === "touched"))
    .sort((a, b) => (a.lastTouchedChapter ?? 0) - (b.lastTouchedChapter ?? 0));
  lines.push(`- open/touched lead：${openLeads.length} 条（超 3 章未推进的停滞底数：${openLeads.filter((t) => maxChapter - t.lastTouchedChapter > 3).length} 条）`);
  if (openLeads.length > 0) {
    lines.push("");
    lines.push("**最旧 open lead（top 10）**：");
    for (const t of openLeads.slice(0, 10)) {
      lines.push(`- idle ${maxChapter - t.lastTouchedChapter} 章 | ch${t.firstSeenChapter} 开 | ${String(t.title ?? "").slice(0, 40)}`);
    }
  }
  // 每章新开线索数（最近 10 章）
  const inflow = new Map();
  for (const t of threads) {
    const ch = t.firstSeenChapter ?? 0;
    inflow.set(ch, (inflow.get(ch) ?? 0) + 1);
  }
  const recentChapters = chapterFiles.slice(-10);
  lines.push("");
  lines.push(`- 每章新开线索数（最近 10 章）：${recentChapters.map((ch) => `ch${ch}=${inflow.get(ch) ?? 0}`).join(" ")}`);
  lines.push("");

  // ---- 资源得失覆盖（修正口径：semanticSummary.gained/lost，来自已核实 resourceDeltas 的确定性派生） ----
  lines.push("## 资源得失覆盖（timeline 事件 semanticSummary.gained/lost）");
  lines.push("");
  const gainedChapters = chapterFiles.filter((ch) => semByChapter.get(ch)?.gained);
  const lostChapters = chapterFiles.filter((ch) => semByChapter.get(ch)?.lost);
  lines.push(`- gained：${gainedChapters.length}/${chapterFiles.length} 章（${gainedChapters.join(",") || "无"}）`);
  lines.push(`- lost：${lostChapters.length}/${chapterFiles.length} 章（${lostChapters.join(",") || "无"}）`);
  lines.push(`- 口径说明：有声明时 gained/lost 只由已核实 resourceDeltas 派生（无核实条目=空，正常）；数量级参考 fact-ledger。`);
  lines.push("");

  // ---- stale 提醒量（验证 r7 里程碑制：本章提醒数应远小于底数，且底数如实） ----
  lines.push("## stale 提醒量（diagnostics 逐章：本章提醒数 vs 全量底数）");
  lines.push("");
  lines.push("| 章 | 本章提醒（线索+目标） | 停滞底数 staleWarningCount | 最旧停滞 |");
  lines.push("|---:|---:|---:|---:|");
  for (const ch of recentChapters) {
    const diag = await readJson(join(book, "diagnostics", `commit-chapter-${String(ch).padStart(4, "0")}.json`));
    const tt = diag?.details?.threadTracking;
    const gt = diag?.details?.arcGoalTracking;
    const reminded = (tt?.staleThreadWarnings?.length ?? 0) + (gt?.staleGoalWarnings?.length ?? 0);
    const backlog = tt?.threadHygieneReport?.staleWarningCount ?? "—";
    const oldest = tt?.threadHygieneReport?.oldestStaleChaptersSinceTouched ?? "—";
    lines.push(`| ${ch} | ${reminded} | ${backlog} | ${oldest} |`);
  }
  lines.push("");

  const md = lines.join("\n");
  if (cfg.out) {
    await writeFile(cfg.out, md, "utf-8");
    console.log(`报告已写入 ${cfg.out}`);
  } else {
    console.log(md);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
