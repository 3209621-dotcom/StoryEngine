import { appendFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  buildCommitPlanFromProject,
  commitFastDraft,
} from "@actalk/story-engine";

import { createConfiguredWriterClient } from "../src/server/lib/llm-client.js";
import { defaultDraftPath } from "../src/server/lib/project-io.js";
import { runGenerateDraftToolLogic } from "../src/server/agent/tools/generate-draft.js";

const projectDir = mustGetEnv("LONGRUN_PROJECT");
const targetChapter = readIntEnv("LONGRUN_END", 300);
const explicitStart = readOptionalIntEnv("LONGRUN_START");
const requestedDraftLength = readIntEnv("LONGRUN_DRAFT_LENGTH", 4000);
const outPath = process.env.LONGRUN_JSONL ?? "/tmp/longrun-engine-300.jsonl";
const reportPath = process.env.LONGRUN_REPORT ?? "/tmp/longrun-engine-300-report.json";
const stopPath = process.env.LONGRUN_STOP ?? "/tmp/longrun-engine-300.stop";
const maxRetries = readIntEnv("LONGRUN_RETRIES", 3);
const maxConsecutiveFailures = readIntEnv("LONGRUN_MAX_CONSECUTIVE_FAILURES", 5);

type Row = {
  readonly chapter: number;
  readonly words: number;
  readonly ok: boolean;
  readonly retries: number;
  readonly ms: number;
  readonly phase: "done" | "draft" | "commit-plan" | "commit";
  readonly title?: string;
  readonly failure?: string;
  readonly draftIssues?: readonly string[];
  readonly commitIssues?: readonly string[];
};

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

function readOptionalIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

function padChapter(chapter: number): string {
  return String(chapter).padStart(4, "0");
}

function nowIso(): string {
  return new Date().toISOString();
}

function countCjkLike(text: string): number {
  return [...text].filter((char) => /[\p{Script=Han}，。！？；：“”‘’（）《》、]/u.test(char)).length;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry<T>(label: string, fn: () => Promise<T>): Promise<{ readonly value?: T; readonly retries: number; readonly error?: string }> {
  let lastError: unknown;
  const delays = [5_000, 15_000, 45_000];
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return { value: await fn(), retries: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 45_000;
      console.log(`[${nowIso()}] ${label} attempt ${attempt + 1} failed: ${stringifyError(error)}; retry in ${delay}ms`);
      await sleep(delay);
    }
  }
  return { retries: maxRetries, error: stringifyError(lastError) };
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function committedChapters(): Promise<number[]> {
  const dir = join(projectDir, "chapters");
  const entries = await readdir(dir).catch(() => []);
  return entries
    .map((entry) => /^(?<chapter>\d{4})\.md$/u.exec(entry)?.groups?.chapter)
    .filter((chapter): chapter is string => Boolean(chapter))
    .map(Number)
    .sort((a, b) => a - b);
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function readRows(): Promise<Row[]> {
  if (!existsSync(outPath)) return [];
  const raw = await readFile(outPath, "utf-8");
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row);
}

async function appendRow(row: Row): Promise<void> {
  await appendFile(outPath, `${JSON.stringify(row)}\n`, "utf-8");
}

function chapterGoal(chapter: number): string {
  if (chapter <= 1) {
    return "第一章正文，约4000字。";
  }
  return `第${chapter}章正文，约4000字。承接上一章已入库状态继续推进，不重复、不跳章、不回退。`;
}

async function runChapter(chapter: number): Promise<Row> {
  const started = Date.now();
  const writerClient = await createConfiguredWriterClient("fastDraft");

  const draftAttempt = await retry(`chapter ${chapter} draft`, async () => {
    const result = await runGenerateDraftToolLogic({
      projectDir,
      chapter,
      chapterGoal: chapterGoal(chapter),
      requestedDraftLength,
      writerClient,
    });
    if (!result.ok || !result.draftBody) {
      throw new Error(result.issues.length > 0 ? result.issues.join("；") : result.summary);
    }
    return result;
  });

  if (!draftAttempt.value) {
    return {
      chapter,
      words: 0,
      ok: false,
      retries: draftAttempt.retries,
      ms: Date.now() - started,
      phase: "draft",
      failure: draftAttempt.error ?? "draft failed",
    };
  }

  const draft = draftAttempt.value;
  const draftPath = defaultDraftPath(projectDir, chapter);
  const words = countCjkLike(draft.draftBody ?? "");

  const commitAttempt = await retry(`chapter ${chapter} commit`, async () => {
    const plan = await buildCommitPlanFromProject({ projectDir, chapter, draftPath });
    if (!plan.passed || !plan.commitPlan) {
      throw new Error(plan.issues.length > 0 ? plan.issues.join("；") : "commit plan failed");
    }
    const report = await commitFastDraft({ projectDir, chapter, draftPath, commitPlan: plan.commitPlan });
    if (!report.passed) {
      throw new Error(report.issues.length > 0 ? report.issues.join("；") : "commit failed");
    }
    return report;
  });

  if (!commitAttempt.value) {
    return {
      chapter,
      words,
      ok: false,
      retries: draftAttempt.retries + commitAttempt.retries,
      ms: Date.now() - started,
      phase: "commit",
      title: draft.draftTitle,
      failure: commitAttempt.error ?? "commit failed",
      draftIssues: draft.issues,
    };
  }

  const chapterPath = join(projectDir, "chapters", `${padChapter(chapter)}.md`);
  if (!(await fileExistsNonEmpty(chapterPath))) {
    return {
      chapter,
      words,
      ok: false,
      retries: draftAttempt.retries + commitAttempt.retries,
      ms: Date.now() - started,
      phase: "commit",
      title: draft.draftTitle,
      failure: `committed file missing: ${chapterPath}`,
      draftIssues: draft.issues,
    };
  }

  return {
    chapter,
    words,
    ok: true,
    retries: draftAttempt.retries + commitAttempt.retries,
    ms: Date.now() - started,
    phase: "done",
    title: draft.draftTitle,
    draftIssues: draft.issues,
  };
}

async function writeReport(extra: Record<string, unknown> = {}): Promise<void> {
  const rows = await readRows();
  const committed = await committedChapters();
  const max = committed.at(-1) ?? 0;
  const missing: number[] = [];
  for (let chapter = 1; chapter <= max; chapter += 1) {
    if (!committed.includes(chapter)) missing.push(chapter);
  }
  const successful = rows.filter((row) => row.ok);
  const failed = rows.filter((row) => !row.ok);
  const avgMs = successful.length > 0
    ? Math.round(successful.reduce((sum, row) => sum + row.ms, 0) / successful.length)
    : 0;
  await writeFile(reportPath, JSON.stringify({
    at: nowIso(),
    projectDir,
    outPath,
    targetChapter,
    committedCount: committed.length,
    committedLast: max,
    committed,
    missing,
    failures: failed,
    totalRetries: rows.reduce((sum, row) => sum + row.retries, 0),
    avgMs,
    sampleChapters: [1, 150, 300, max].map((chapter) => ({
      chapter,
      path: join(projectDir, "chapters", `${padChapter(chapter)}.md`),
      exists: existsSync(join(projectDir, "chapters", `${padChapter(chapter)}.md`)),
    })),
    ...extra,
  }, null, 2), "utf-8");
}

async function main(): Promise<void> {
  const existing = await committedChapters();
  const resumeChapter = (existing.at(-1) ?? 0) + 1;
  const start = explicitStart ?? resumeChapter;
  console.log(`[${nowIso()}] project=${projectDir}`);
  console.log(`[${nowIso()}] committedLast=${existing.at(-1) ?? 0}; start=${start}; end=${targetChapter}`);

  let consecutiveFailures = 0;
  for (let chapter = start; chapter <= targetChapter; chapter += 1) {
    if (existsSync(stopPath)) {
      console.log(`[${nowIso()}] stop file detected: ${stopPath}`);
      await writeReport({ stoppedBy: "stop-file", stopPath });
      return;
    }

    console.log(`[${nowIso()}] chapter ${chapter}/${targetChapter} start`);
    const row = await runChapter(chapter);
    await appendRow(row);
    console.log(`[${nowIso()}] chapter ${chapter} ${row.ok ? "OK" : "FAIL"} words=${row.words} retries=${row.retries} ms=${row.ms} phase=${row.phase}${row.failure ? ` failure=${row.failure}` : ""}`);

    consecutiveFailures = row.ok ? 0 : consecutiveFailures + 1;
    if (chapter % 20 === 0 || !row.ok || chapter === targetChapter) {
      await writeReport({ lastRow: row });
      const report = JSON.parse(await readFile(reportPath, "utf-8")) as { committedLast?: number; missing?: unknown[]; failures?: unknown[]; totalRetries?: number; avgMs?: number };
      console.log(`[PROGRESS] committedLast=${report.committedLast} missing=${report.missing?.length ?? 0} failures=${report.failures?.length ?? 0} retries=${report.totalRetries} avgMs=${report.avgMs}`);
    }
    if (consecutiveFailures >= maxConsecutiveFailures) {
      await writeReport({ stoppedBy: "consecutive-failures", consecutiveFailures });
      console.log(`[${nowIso()}] halt: ${consecutiveFailures} consecutive failures`);
      return;
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  await writeReport({ stoppedBy: "fatal-error", error: stringifyError(error) }).catch(() => undefined);
  process.exitCode = 1;
});
