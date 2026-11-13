/**
 * Character-level diff for typed answers (LCS over grapheme clusters, so combining marks,
 * emoji and Persian/Arabic letters stay intact). Purely informational – never used for grading.
 */
export type DiffOp = 'same' | 'extra' | 'missing';
export interface DiffPart { op: DiffOp; text: string }

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s);
}

export interface DiffOptions { ignoreCase?: boolean; ignorePunctuation?: boolean }

const PUNCT = /^[\p{P}\p{S}]$/u;
function norm(g: string, o: DiffOptions): string {
  let s = g.normalize('NFC');
  if (o.ignoreCase) s = s.toLocaleLowerCase();
  return s;
}

/** Longest-common-subsequence diff. Inputs above MAX graphemes fall back to word level. */
const MAX = 3000;
export function diff(typed: string, solution: string, o: DiffOptions = {}): DiffPart[] {
  let a = graphemes(typed.replace(/\s+/g, ' ').trim());
  let b = graphemes(solution.replace(/\s+/g, ' ').trim());
  if (a.length > MAX || b.length > MAX) {
    a = typed.trim().split(/(\s+)/);
    b = solution.trim().split(/(\s+)/);
  }
  const skip = (g: string) => !!o.ignorePunctuation && PUNCT.test(g);
  const ka = a.map((g) => norm(g, o));
  const kb = b.map((g) => norm(g, o));
  const n = a.length, m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (op: DiffOp, text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) { push('same', b[j]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { push(skip(b[j]) ? 'same' : 'missing', b[j]); j++; }
    else { push(skip(a[i]) ? 'same' : 'extra', a[i]); i++; }
  }
  return out;
}

export const isIdentical = (parts: DiffPart[]) => parts.every((p) => p.op === 'same');

/** Of several accepted answers, the one closest to what was typed. */
export function closest(typed: string, answers: string[], o: DiffOptions = {}): { answer: string; parts: DiffPart[] } {
  let best = { answer: answers[0] ?? '', parts: diff(typed, answers[0] ?? '', o) };
  let bestCost = cost(best.parts);
  for (const ans of answers.slice(1)) {
    const parts = diff(typed, ans, o);
    const c = cost(parts);
    if (c < bestCost) { best = { answer: ans, parts }; bestCost = c; }
  }
  return best;
}
const cost = (parts: DiffPart[]) => parts.reduce((s, p) => s + (p.op === 'same' ? 0 : graphemes(p.text).length), 0);
