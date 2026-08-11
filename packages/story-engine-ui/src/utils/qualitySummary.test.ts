import { describe, expect, it } from "vitest";
import type { DraftQualityReport } from "../api/types.js";
import { qualityIssueDisplayText, summarizeDraftQualityReport } from "./qualitySummary.js";

describe("quality summary", () => {
  it("renders fallback model failures as explicit Chinese status", () => {
    const quality: DraftQualityReport = {
      passed: false,
      issues: [{
        severity: "error",
        type: "too_short",
        message: "Draft body is shorter than 300 Chinese characters.",
        candidateId: "draft_quality:too_short:1",
        judgement: {
          candidateId: "draft_quality:too_short:1",
          verdict: "confirmed",
          severity: "high",
          explanation: "Rule-based structural check marked this candidate as a hard blocker.",
          recommendedAction: "require_confirmation",
        },
        userDisplayCategory: "confirmed",
      }],
      judgedIssues: [{
        id: "draft_quality:too_short:1",
        source: "draft_quality",
        type: "too_short",
        message: "Draft body is shorter than 300 Chinese characters.",
        evidence: "Draft body is shorter than 300 Chinese characters.",
        severityHint: "high",
        confidenceHint: 0.95,
        status: "judged",
        judgement: {
          candidateId: "draft_quality:too_short:1",
          verdict: "confirmed",
          severity: "high",
          explanation: "Rule-based structural check marked this candidate as a hard blocker.",
          recommendedAction: "require_confirmation",
        },
        userDisplayCategory: "confirmed",
      }],
      modelJudge: {
        used: true,
        fallbackUsed: true,
        error: "模型请求超时：25000ms",
        summary: "AI 判定未完成，已保留规则候选与默认风险分类。",
      },
    };

    const summary = summarizeDraftQualityReport(quality);

    expect(summary.content).toContain("AI 语义判定未完成");
    expect(summary.content).toContain("模型请求超时：25000ms");
    expect(summary.cardDetail[0]).toContain("正文字数少于 300 个中文字符");
    expect(summary.cardDetail[0]).toContain("规则确认这是硬阻断问题");
  });

  it("translates common quality issue messages", () => {
    expect(qualityIssueDisplayText({
      type: "writing_context_identity_detail_drift",
      message: "Draft may invent unregistered identity details: 林序站在海港集团.",
      evidence: "Draft may invent unregistered identity details: 林序站在海港集团.",
    })).toBe("可能写入未登记身份细节：林序站在海港集团.");
    expect(qualityIssueDisplayText({
      type: "no_dialogue",
      message: "Draft does not contain obvious dialogue.",
      evidence: "Draft does not contain obvious dialogue.",
    })).toBe("正文没有明显对话");
  });

  it("B7：噪音启发式类目的『待确认』展示层降为『观察项』，confirmed 与非噪音类目保留", () => {
    const mk = (id: string, type: string, cat: "needs_confirmation" | "confirmed") => ({
      id, source: "draft_quality" as const, type,
      message: id, evidence: id, severityHint: "medium" as const, confidenceHint: 0.55, status: "judged" as const,
      judgement: { candidateId: id, verdict: cat === "confirmed" ? "confirmed" as const : "uncertain" as const, severity: "medium" as const, explanation: "x", recommendedAction: "ask_user" as const },
      userDisplayCategory: cat,
    });
    const quality = {
      passed: true, issues: [], chapter: 1,
      judgedIssues: [
        mk("a", "writing_context_location_drift", "needs_confirmation"),   // 噪音类目·待确认 → 降观察项
        mk("b", "cross_chapter_pronoun_drift", "needs_confirmation"),      // 噪音类目·待确认 → 降观察项
        mk("c", "continuity_conflict", "needs_confirmation"),             // 非噪音·待确认 → 保留
        mk("d", "writing_context_location_drift", "confirmed"),           // 噪音类目但 AI 已 confirmed → 保留
      ],
    } as unknown as Parameters<typeof summarizeDraftQualityReport>[0];
    const summary = summarizeDraftQualityReport(quality);
    expect(summary.needsConfirmation).toBe(1); // 只剩非噪音的 c
    expect(summary.confirmed).toBe(1);          // 噪音但 confirmed 的 d 保留
    expect(summary.watch).toBe(2);              // a、b 被降为观察项
  });
});
