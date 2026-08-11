/**
 * 字符级 diff（LCS）——把「改写前 / 改写后」两段文本对齐成「相等 / 删除 / 新增」片段，
 * 供选区改写预览做行内高亮对照（删去划掉、新增高亮），一眼看出改了什么。
 * 中文按字符切分即可（token ≈ 字）。文本过长则跳过 DP（整删整增），避免 O(n*m) 过重。
 */
export type DiffSeg = { readonly type: "equal" | "add" | "del"; readonly text: string };

const MAX_DIFF_CHARS = 4000;

export function diffChars(before: string, after: string): readonly DiffSeg[] {
  const a = Array.from(before);
  const b = Array.from(after);
  if (a.length + b.length > MAX_DIFF_CHARS) {
    const big: DiffSeg[] = [];
    if (a.length) big.push({ type: "del", text: before });
    if (b.length) big.push({ type: "add", text: after });
    return big;
  }
  const n = a.length;
  const m = b.length;
  // LCS 长度表：dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs: DiffSeg[] = [];
  const push = (type: DiffSeg["type"], ch: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) segs[segs.length - 1] = { type, text: last.text + ch };
    else segs.push({ type, text: ch });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("equal", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < n) { push("del", a[i]); i++; }
  while (j < m) { push("add", b[j]); j++; }
  return segs;
}
