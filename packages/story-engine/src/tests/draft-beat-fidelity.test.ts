import { describe, expect, it } from "vitest";
import { checkDraftBeatFidelity } from "../draft-beat-fidelity.js";

// 出稿首稿保真度（Codex 复测额外发现：首稿把「第三块砖」写成「第三层杂志架」、「债权池A-17」写成数字串、漏 beat）。
// 确定性、题材中立、只软警告不阻塞：检查用户/agent 指定的「必须命中要点」里的【具体锚点】（标识符码 / 数字+量词+名物）
// 是否落进草稿；缺了就报 missing。纯结果/可改写的 beat（无具体锚点）跳过不检（避免误杀正常改写）。
describe("checkDraftBeatFidelity · 出稿后保真软警告", () => {
  it("空 beat 列表 → passed、无 issue", () => {
    const r = checkDraftBeatFidelity({ draftContent: "随便一段正文。", mustHitBeats: [] });
    expect(r.passed).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.missingBeats).toEqual([]);
  });

  it("标识符锚点命中（草稿原样含 A-17）→ 不算缺", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她在收据背面看见一行小字：债权池A-17。",
      mustHitBeats: ["债权池A-17"],
    });
    expect(r.missingBeats).toEqual([]);
    expect(r.checkedBeats).toContain("债权池A-17");
    expect(r.passed).toBe(true);
  });

  it("标识符被写歪（A-17 写成数字串）→ 报缺", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她看见一行字：债权池17号。",
      mustHitBeats: ["债权池A-17"],
    });
    expect(r.missingBeats).toContain("债权池A-17");
    expect(r.passed).toBe(false);
    expect(r.issues[0]).toMatchObject({ severity: "warning", type: "missing_required_beat", beat: "债权池A-17" });
  });

  it("数字+量词+名物被换（第三块砖 写成 第三层杂志架）→ 报缺", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她蹲下，撬开第三层杂志架后面的暗格。",
      mustHitBeats: ["第三块砖"],
    });
    expect(r.missingBeats).toContain("第三块砖");
    expect(r.passed).toBe(false);
  });

  it("数字+量词+名物被合理改写（第三块砖→第三块青砖，量词与名物都在）→ 不算缺", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她蹲下，用力撬开第三块青砖。",
      mustHitBeats: ["第三块砖"],
    });
    expect(r.missingBeats).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("纯结果/可改写 beat（无具体锚点，如「周衡会先倒霉」）→ 跳过不检、不误报", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "许鸣警告她，再查下去，周衡的铺子会被强制清算。",
      mustHitBeats: ["周衡会先倒霉"],
    });
    expect(r.missingBeats).toEqual([]);
    expect(r.checkedBeats).not.toContain("周衡会先倒霉"); // 无锚点=不可检=跳过
    expect(r.passed).toBe(true);
  });

  it("多 beat 混合：可检的命中/漏 各自判定，不可检的跳过", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她撬开第三块砖，取出收据，上面写着债权池17号。许鸣来了。",
      mustHitBeats: ["第三块砖", "债权池A-17", "许鸣登场威胁"],
    });
    // 第三块砖命中、A-17 漏、许鸣登场威胁无锚点跳过
    expect(r.missingBeats).toEqual(["债权池A-17"]);
    expect(r.checkedBeats).toEqual(expect.arrayContaining(["第三块砖", "债权池A-17"]));
    expect(r.checkedBeats).not.toContain("许鸣登场威胁");
  });
});

// 对抗性审查（13 agent）确认的 4 类弱点：标识符整章拼接串吞误（超串/跨token）、量词表不全、全角数字、名物泛匹配。
describe("checkDraftBeatFidelity · 对抗性审查暴露弱点的修复", () => {
  it("标识符超串：A-17 漏写但草稿含 A-170 → 仍报缺（不被超串吞掉）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "法院只冻结了A-170账户，别的没动。",
      mustHitBeats: ["债权池A-17"],
    });
    expect(r.missingBeats).toContain("债权池A-17");
  });

  it("标识符跨token：草稿有‘A区’和‘第17号’但无 A-17 → 仍报缺（不被拼接成 a17）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "他走进A区，翻到第17号卷宗，却没找到要的东西。",
      mustHitBeats: ["债权池A-17"],
    });
    expect(r.missingBeats).toContain("债权池A-17");
  });

  it("标识符精确命中仍判通过（不回归）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她翻到收据，背面写着债权池A-17。",
      mustHitBeats: ["债权池A-17"],
    });
    expect(r.missingBeats).toEqual([]);
  });

  it("全角标识符：草稿把 A-17 写成全角Ａ－１７ → 不误报（视为已命中）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她翻到收据，背面写着债权池Ａ－１７。",
      mustHitBeats: ["债权池A-17"],
    });
    expect(r.missingBeats).toEqual([]);
  });

  it("量词扩表：第二只羊漏写 → 报缺；写到了 → 通过", () => {
    const missing = checkDraftBeatFidelity({
      draftContent: "牧场上空荡荡的，栅栏开着，一片狼藉。",
      mustHitBeats: ["第二只羊"],
    });
    expect(missing.missingBeats).toContain("第二只羊");
    expect(missing.checkedBeats).toContain("第二只羊");

    const hit = checkDraftBeatFidelity({
      draftContent: "他牵走了第二只羊，头也不回。",
      mustHitBeats: ["第二只羊"],
    });
    expect(hit.missingBeats).toEqual([]);
  });

  it("多字名物：第三个木箱写成别的 → 报缺；写到了 → 通过", () => {
    const missing = checkDraftBeatFidelity({
      draftContent: "她翻遍了整间仓库，只有积灰和旧报纸。",
      mustHitBeats: ["第三个木箱"],
    });
    expect(missing.missingBeats).toContain("第三个木箱");

    const hit = checkDraftBeatFidelity({
      draftContent: "她撬开角落里第三个木箱，扬起一团灰。",
      mustHitBeats: ["第三个木箱"],
    });
    expect(hit.missingBeats).toEqual([]);
  });
});

// Codex retest4：beat「乔蔓语气冷淡，"别碰药柜左边那排。"」无标识符/量词名物锚点 → 被现有逻辑直接跳过，
// 从未被检查；草稿里这句台词逐字命中，但说话人被写成了秦屿（不是乔蔓），agent 仍口头称「全部命中」——
// 看起来通过、其实没真核对说话人。新增「说话人归属」锚点：beat 含「具名角色+归属动词/语气词+引号台词」时，
// 核对草稿里这句台词的出现处，说话人是否真是指定的那个角色。V1 只认「说话人在引号之前」语序（与仓库已有
// isDialogueAttributionSentence 同方言对齐）；反序「『……』X说。」是已知局限，留给下一轮真机撞到再扩。
describe("checkDraftBeatFidelity · 说话人归属核对（Codex retest4：台词命中但说话人错，仍报全部命中）", () => {
  it("台词逐字命中、说话人也对 → 通过（不误报）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "乔蔓语气冷淡，“别碰药柜左边那排。”",
      mustHitBeats: ["乔蔓语气冷淡，“别碰药柜左边那排。”"],
    });
    expect(r.missingBeats).toEqual([]);
    expect(r.checkedBeats).toContain("乔蔓语气冷淡，“别碰药柜左边那排。”");
    expect(r.passed).toBe(true);
  });

  it("台词逐字命中、但说话人被写成了别人 → 报 speaker_misattribution（真实案例：乔蔓→秦屿）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "秦屿语气冷淡，“别碰药柜左边那排。”",
      mustHitBeats: ["乔蔓语气冷淡，“别碰药柜左边那排。”"],
    });
    expect(r.missingBeats).toContain("乔蔓语气冷淡，“别碰药柜左边那排。”");
    expect(r.passed).toBe(false);
    expect(r.issues[0]).toMatchObject({ severity: "warning", type: "speaker_misattribution" });
    expect(r.issues[0]?.message).toContain("秦屿");
    expect(r.issues[0]?.message).toContain("乔蔓");
  });

  it("台词压根没写进草稿 → 按现有缺失语义报 missing_required_beat（不是 speaker_misattribution）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "陆峥站在药柜前，什么也没说。",
      mustHitBeats: ["乔蔓语气冷淡，“别碰药柜左边那排。”"],
    });
    expect(r.missingBeats).toContain("乔蔓语气冷淡，“别碰药柜左边那排。”");
    expect(r.issues[0]).toMatchObject({ type: "missing_required_beat" });
  });

  it("台词命中但归属结构模糊（转述/回忆，抽不出清晰说话人）→ 跳过不报（favor 低误报）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "陆峥想起乔蔓那句“别碰药柜左边那排。”，心头一紧。",
      mustHitBeats: ["乔蔓语气冷淡，“别碰药柜左边那排。”"],
    });
    expect(r.missingBeats).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("说话人代词（他/她/对方…）不当作真实归属、不误判 mismatch", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "她语气冷淡，“别碰药柜左边那排。”",
      mustHitBeats: ["乔蔓语气冷淡，“别碰药柜左边那排。”"],
    });
    // 抽不出清晰具名说话人（代词被排除）→ 模糊跳过，不误报 mismatch
    expect(r.missingBeats).toEqual([]);
  });

  it("同一台词出现多次，至少一处说话人对 → 通过", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "秦屿冷笑，“别碰药柜左边那排。”陆峥没理他。乔蔓语气冷淡，“别碰药柜左边那排。”",
      mustHitBeats: ["乔蔓语气冷淡，“别碰药柜左边那排。”"],
    });
    expect(r.missingBeats).toEqual([]);
  });

  it("说话人用「说」「问」等动词归属（不止声音/语气）也能核对", () => {
    const ok = checkDraftBeatFidelity({
      draftContent: "乔蔓说，“别碰药柜左边那排。”",
      mustHitBeats: ["乔蔓说，“别碰药柜左边那排。”"],
    });
    expect(ok.missingBeats).toEqual([]);

    const mismatch = checkDraftBeatFidelity({
      draftContent: "秦屿说，“别碰药柜左边那排。”",
      mustHitBeats: ["乔蔓说，“别碰药柜左边那排。”"],
    });
    expect(mismatch.missingBeats).toContain("乔蔓说，“别碰药柜左边那排。”");
    expect(mismatch.issues[0]).toMatchObject({ type: "speaker_misattribution" });
  });
});

// Codex retest5：V1 只认「说话人紧邻归属动词」，真机两种常见句式直接漏判——
// ① 「X盯着Y说，"……"」：归属动词"说"紧邻的是宾语Y（被盯的人），真正说话人是句首主语X；
// ② 「X[一长段动作描写]，语气冷淡，"……"」：说话人和归属词之间常隔着大段动作描写，不紧邻。
// 这两种在真实草稿里命中率很高，V1 narrow-adjacency 设计基本测不到任何真实反例（report：「核心警告未被
// 真正触发」）。本轮收紧设计：说话人 = 当前分句【起头】的具名角色（不是紧邻归属动词的那个），归属动词只需
// 在主语之后、引号之前的某处出现即可，不要求紧邻。
describe("checkDraftBeatFidelity · 说话人归属·分句主语识别（Codex retest5：「X盯着Y说」型 + 长动作描写型）", () => {
  it("「X盯着Y说」：说话人是句首主语X，不是紧邻「说」的宾语Y（换旁观对象名字以拆穿『两边抓错但碰巧对上』的假阳性）", () => {
    // 同一真说话人沈砚，beat 和草稿里被盯的「旁观对象」名字不同（顾寒 vs 林岚）——若说话人识别仍是「就近抓
    // 紧邻归属动词的那个名字」（旧逻辑：抓到的是宾语 顾寒/林岚，不是真正说话人 沈砚），两边会因为旁观对象不同
    // 而被错误判为 mismatch；只有真正识别出「主语=沈砚」才会两边一致、判通过。
    const ok = checkDraftBeatFidelity({
      draftContent: "沈砚盯着林岚说，“那你为什么比我先到影院？”",
      mustHitBeats: ["沈砚盯着顾寒说，“那你为什么比我先到影院？”"],
    });
    expect(ok.missingBeats).toEqual([]);
    expect(ok.passed).toBe(true);

    // 真正换了说话人（顾寒说，不是沈砚说）才应该报 mismatch，且抽出的「错说话人」必须是顾寒（句首主语），
    // 不能是「盯着沈砚」这种带动词的垃圾片段。
    const mismatch = checkDraftBeatFidelity({
      draftContent: "顾寒盯着沈砚说，“那你为什么比我先到影院？”",
      mustHitBeats: ["沈砚盯着顾寒说，“那你为什么比我先到影院？”"],
    });
    expect(mismatch.missingBeats).toContain("沈砚盯着顾寒说，“那你为什么比我先到影院？”");
    expect(mismatch.issues[0]).toMatchObject({ type: "speaker_misattribution" });
    expect(mismatch.issues[0]?.message).toContain("说话人被写成了「顾寒」");
  });

  it("「X[长动作描写]，语气冷淡，引号」：说话人和归属词中间隔着大段动作描写也能识别（真实案例：顾寒站在走廊尽头）", () => {
    const ok = checkDraftBeatFidelity({
      draftContent: "顾寒站在走廊尽头，西装外套搭在臂弯，语气冷淡，“红线账不是你父亲留下的，是他偷出来的。”",
      mustHitBeats: ["顾寒语气冷淡，“红线账不是你父亲留下的，是他偷出来的。”"],
    });
    expect(ok.missingBeats).toEqual([]);

    const mismatch = checkDraftBeatFidelity({
      draftContent: "沈砚站在走廊尽头，西装外套搭在臂弯，语气冷淡，“红线账不是你父亲留下的，是他偷出来的。”",
      mustHitBeats: ["顾寒语气冷淡，“红线账不是你父亲留下的，是他偷出来的。”"],
    });
    expect(mismatch.missingBeats).toContain("顾寒语气冷淡，“红线账不是你父亲留下的，是他偷出来的。”");
    expect(mismatch.issues[0]).toMatchObject({ type: "speaker_misattribution" });
  });

  it("beat 本身也支持「X盯着Y说」/长动作描写句式抽取（不止草稿侧）", () => {
    const r = checkDraftBeatFidelity({
      draftContent: "顾寒没说话。沈砚盯着他。",
      mustHitBeats: ["沈砚盯着顾寒说，“那你为什么比我先到影院？”"],
    });
    // beat 能正确抽出 (沈砚, 台词)，台词没写进草稿 → missing_required_beat（不是被当成无锚点跳过）
    expect(r.checkedBeats).toContain("沈砚盯着顾寒说，“那你为什么比我先到影院？”");
    expect(r.missingBeats).toContain("沈砚盯着顾寒说，“那你为什么比我先到影院？”");
  });
});
