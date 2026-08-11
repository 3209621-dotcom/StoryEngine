// @vitest-environment node
//
// web_search 纯逻辑单测：Bing HTML 解析（防御性）、实体解码、编排层诚实回报
//（空 query 退化输入 / 网络失败 / 超时 / 零结果分开措辞），fetch 注入不走真网络。
import { describe, expect, it } from "vitest";

import {
  buildWebSearchSummary,
  decodeHtmlEntities,
  parseBingResults,
  runWebSearch,
  stripHtmlTags,
} from "./web-search.js";

function bingHtml(items: readonly { title: string; url: string; snippet?: string }[]): string {
  const blocks = items.map(({ title, url, snippet }) =>
    `<li class="b_algo"><h2><a href="${url}" h="ID=1">${title}</a></h2>` +
    `<div class="b_caption">${snippet ? `<p>${snippet}</p>` : ""}</div></li>`,
  );
  return `<html><body><ol id="b_results">${blocks.join("")}</ol></body></html>`;
}

function fetchReturning(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe("HTML 工具", () => {
  it("decodeHtmlEntities：命名/十进制/十六进制实体；未知实体原样保留", () => {
    expect(decodeHtmlEntities("A&amp;B &#0183; &#x4e2d; &nbsp;&unknown;")).toBe("A&B · 中  &unknown;");
  });

  it("stripHtmlTags：去标签 + 解实体 + 压空白", () => {
    expect(stripHtmlTags("<b>镖局</b>&ensp;·&ensp;<i>清代</i>\n  行业")).toBe("镖局 · 清代 行业");
  });
});

describe("parseBingResults（防御性解析）", () => {
  it("解析标题/链接/摘要，尊重 maxResults 与去重", () => {
    const html = bingHtml([
      { title: "清代<b>镖局</b>制度", url: "https://a.example.com/1", snippet: "镖局起源于&amp;明清…" },
      { title: "重复链接", url: "https://a.example.com/1", snippet: "去重" },
      { title: "第二条", url: "https://b.example.com/2" },
      { title: "第三条", url: "https://c.example.com/3", snippet: "超出上限" },
    ]);
    const results = parseBingResults(html, 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "清代镖局制度", url: "https://a.example.com/1", snippet: "镖局起源于&明清…" });
    expect(results[1].url).toBe("https://b.example.com/2");
  });

  it("结构对不上/非 http 链接 → 空数组，不抛错不编造", () => {
    expect(parseBingResults("<html><body>反爬挑战页</body></html>", 5)).toEqual([]);
    expect(parseBingResults(bingHtml([{ title: "坏链接", url: "javascript:void(0)" }]), 5)).toEqual([]);
    // 评审加固：httpx: 之类的伪协议也不能当来源
    expect(parseBingResults(bingHtml([{ title: "伪协议", url: "httpx://evil.example" }]), 5)).toEqual([]);
  });

  it("class 按 token 匹配：属性顺序/多 class 变体也能解析（评审加固）", () => {
    const html = `<li data-x="1" class="b_algo extra"><h2><span></span><a href="https://ok.example/a">变体条目</a></h2><p>正文</p></li>`;
    const results = parseBingResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("变体条目");
    // b_algoX 这类相似 class 不能误认
    expect(parseBingResults(`<li class="b_algoX"><h2><a href="https://x.example/b">别认我</a></h2></li>`, 5)).toEqual([]);
  });

  it("异常超长页面被截断解析，不吃满内存（评审加固）", () => {
    const junk = "<div>x</div>".repeat(300_000); // ~3.6MB 垃圾前缀，把结果块挤出 2MB 预算
    const html = junk + bingHtml([{ title: "被挤出预算", url: "https://tail.example/1" }]);
    expect(parseBingResults(html, 5)).toEqual([]); // 截断丢弃尾部——宁可空结果诚实回报，不做无界解析
  });
});

describe("runWebSearch（编排层诚实回报）", () => {
  it("正常检索 → ok:true + 面向用户 summary（带来源域名 + 参考资料提示）", async () => {
    const out = await runWebSearch({
      query: "清代镖局",
      fetchImpl: fetchReturning(bingHtml([
        { title: "镖局史话", url: "https://www.example.com/biao", snippet: "护送货物的机构" },
      ])),
    });
    expect(out.ok).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.summary).toContain("镖局史话");
    expect(out.summary).toContain("example.com");
    expect(out.summary).toContain("参考资料");
  });

  it("空 query（模型退化输入）→ 诚实失败，不发请求", async () => {
    let called = false;
    const out = await runWebSearch({
      query: "   ",
      fetchImpl: (async () => { called = true; return new Response(""); }) as typeof fetch,
    });
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("搜索关键词");
    expect(called).toBe(false);
  });

  it("网络失败 → ok:false + 如实说明 + 绝不编造", async () => {
    const out = await runWebSearch({
      query: "测试",
      fetchImpl: (async () => { throw new Error("boom"); }) as typeof fetch,
    });
    expect(out.ok).toBe(false);
    expect(out.results).toEqual([]);
    expect(out.summary).toContain("没查成");
    expect(out.summary).toContain("不会编造");
  });

  it("返回反爬页（零结果）→ ok:false 且措辞区别于网络失败", async () => {
    const out = await runWebSearch({ query: "测试", fetchImpl: fetchReturning("<html>challenge</html>") });
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("没有检索到可用结果");
  });

  it("非 200 状态 → 按失败处理", async () => {
    const out = await runWebSearch({ query: "测试", fetchImpl: fetchReturning("", 503) });
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("没查成");
  });

  it("maxResults 退化输入（0/负数）→ 用默认值不炸", async () => {
    const html = bingHtml(Array.from({ length: 8 }, (_, i) => ({ title: `条目${i}`, url: `https://e.com/${i}` })));
    const out = await runWebSearch({ query: "多结果", maxResults: 0, fetchImpl: fetchReturning(html) });
    expect(out.ok).toBe(true);
    expect(out.results.length).toBe(5); // DEFAULT_MAX_RESULTS
  });
});

describe("buildWebSearchSummary", () => {
  it("条目化 + 序号 + 域名剥 www + 长摘要截断", () => {
    const summary = buildWebSearchSummary("测试", [
      { title: "甲", url: "https://www.foo.com/a", snippet: "长".repeat(120) },
      { title: "乙", url: "https://bar.org/b", snippet: "" },
    ]);
    expect(summary).toContain("1. 甲（foo.com）");
    expect(summary).toContain("2. 乙（bar.org)".replace(")", "）"));
    expect(summary).toContain("…");
    expect(summary).not.toMatch(/web_search|bing/iu);
  });
});
