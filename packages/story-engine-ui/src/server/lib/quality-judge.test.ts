import { describe, expect, it } from "vitest";
import type { CommitQualityReport, QualityAiJudgement } from "@actalk/story-engine";
import { mergeQualityJudgements } from "./quality-judge.js";

describe("quality judge merge", () => {
  it("does not let the model dismiss cross-chapter pronoun drift", () => {
    const report: CommitQualityReport = {
      passed: true,
      issues: [{
        severity: "warning",
        type: "cross_chapter_pronoun_drift",
        message: "角色称谓可能漂移：沈砚 之前按女性/她叙述，本章出现男性/他叙述。",
        candidateId: "draft_quality:cross_chapter_pronoun_drift:1",
      }],
      candidates: [{
        id: "draft_quality:cross_chapter_pronoun_drift:1",
        source: "draft_quality",
        type: "cross_chapter_pronoun_drift",
        message: "角色称谓可能漂移：沈砚 之前按女性/她叙述，本章出现男性/他叙述。",
        evidence: "沈砚从檐影里走出来，他拍了拍林远的肩膀。",
        severityHint: "medium",
        confidenceHint: 0.55,
        status: "candidate",
      }],
    };
    const dismissed: QualityAiJudgement = {
      candidateId: "draft_quality:cross_chapter_pronoun_drift:1",
      verdict: "dismissed",
      severity: "none",
      explanation: "模型认为可能是作者意图。",
      recommendedAction: "ignore",
    };

    const merged = mergeQualityJudgements(report, [dismissed], {
      used: true,
      fallbackUsed: false,
      model: "test-model",
    });

    expect(merged.issues[0]).toMatchObject({
      type: "cross_chapter_pronoun_drift",
      userDisplayCategory: "needs_confirmation",
      judgement: expect.objectContaining({
        verdict: "uncertain",
        severity: "medium",
        recommendedAction: "ask_user",
      }),
    });
  });

  it("放行点出指代对象的实质 pronoun drift dismiss（治『他指别人』误报）", () => {
    const report: CommitQualityReport = {
      passed: true,
      issues: [{
        severity: "warning",
        type: "cross_chapter_pronoun_drift",
        message: "角色称谓可能漂移：孟娆 本章出现男性/他叙述。",
        candidateId: "draft_quality:cross_chapter_pronoun_drift:1",
      }],
      candidates: [{
        id: "draft_quality:cross_chapter_pronoun_drift:1",
        source: "draft_quality",
        type: "cross_chapter_pronoun_drift",
        message: "角色称谓可能漂移：孟娆 本章出现男性/他叙述。",
        evidence: "孟娆要请他喝茶。他在这个城市里没有任何根基。",
        severityHint: "medium",
        confidenceHint: 0.55,
        status: "candidate",
      }],
    };
    const dismissed: QualityAiJudgement = {
      candidateId: "draft_quality:cross_chapter_pronoun_drift:1",
      verdict: "dismissed",
      severity: "none",
      explanation: "这里的『他』指的是林远、不是孟娆，孟娆是女性、叙述无矛盾。",
      recommendedAction: "ignore",
    };
    const merged = mergeQualityJudgements(report, [dismissed], { used: true, fallbackUsed: false, model: "test-model" });
    // 实质指代解释 → 尊重模型的 dismissed，不再焊回待确认。
    expect(merged.issues[0]?.judgement?.verdict).toBe("dismissed");
  });

  it("replaces weak pronoun drift explanations with evidence-backed wording", () => {
    const report: CommitQualityReport = {
      passed: true,
      issues: [{
        severity: "warning",
        type: "cross_chapter_pronoun_drift",
        message: "角色称谓可能漂移：沈砚。前文证据：她提醒林远；本章证据：他拍了拍林远。",
        candidateId: "draft_quality:cross_chapter_pronoun_drift:1",
      }],
      candidates: [{
        id: "draft_quality:cross_chapter_pronoun_drift:1",
        source: "draft_quality",
        type: "cross_chapter_pronoun_drift",
        message: "角色称谓可能漂移：沈砚。前文证据：她提醒林远；本章证据：他拍了拍林远。",
        evidence: "前文证据：她提醒林远；本章证据：他拍了拍林远。",
        severityHint: "medium",
        confidenceHint: 0.55,
        status: "candidate",
      }],
    };

    const merged = mergeQualityJudgements(report, [{
      candidateId: "draft_quality:cross_chapter_pronoun_drift:1",
      verdict: "uncertain",
      severity: "medium",
      explanation: "上下文未提供沈砚明确性别。",
      recommendedAction: "ask_user",
    }], {
      used: true,
      fallbackUsed: false,
      model: "test-model",
    });

    expect(merged.issues[0]?.judgement?.explanation).toContain("称谓不一致");
    expect(merged.issues[0]?.judgement?.explanation).toContain("她提醒林远");
    expect(merged.issues[0]?.judgement?.explanation).not.toContain("上下文未提供");
  });
});
