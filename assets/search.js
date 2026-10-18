// 休薬情報データベース — あいまい検索 (ブラウザ / Node.js 共通、 外部ライブラリなし、 MIT)
//
// 使い方 (ブラウザ。 Node.js は URL からの import 非対応なので、 このファイルを ダウンロードして import する):
//   import { buildIndex, search, suggest } from 'https://numero-uno-jpn.github.io/kyuyaku-data/assets/search.js';
//   const data = await (await fetch('https://numero-uno-jpn.github.io/kyuyaku-data/v1/search-index.json')).json();
//   const index = buildIndex(data.drugs);
//   search(index, 'アスピリソ');   // → [{ name: 'アスピリン', score: 63, term: 'アスピリン', kind: 'typo' }, …]

const SMALL_KANA = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };

/** 基本の 正規化: 全角/半角・空白・ひらがな→カタカナ・小書き文字・大文字小文字 の 違いを 吸収 */
export const normalize = (s) => (s ?? '').toString()
  .normalize('NFKC')
  .replace(/[\s　]/g, '')
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  .replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => SMALL_KANA[c] ?? c)
  .toLowerCase();

/** 表記ゆれ用の キー: さらに 長音・ハイフン類、 濁点・半濁点、 ヴ/ブ の 違いを 吸収 */
export const fuzzyKey = (s) => normalize(s)
  .replace(/ヴ/g, 'ブ')
  .normalize('NFD').replace(/[゙゚]/g, '').normalize('NFC')
  .replace(/[ー‐\-−–—~〜・･.,、。()（）［］\[\]「」『』®™]/g, '');

/** b の どこか 一部分と a の 最小編集距離 (近似部分一致。 Sellers のアルゴリズム) */
function substringDistance(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev);
}

// 入力の 長さに 応じて 許す 打ち間違いの 数 (短い入力で 何にでも 当たらないように)
const allowedTypos = (len) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/**
 * 検索用の 索引を 作る。
 * @param {{name: string, category?: string, terms?: string[]}[]} entries  terms は 別名・商品名・後発品名 等
 */
export function buildIndex(entries) {
  return entries.map((e) => {
    const raw = [...new Set([e.name, ...(e.terms ?? [])].filter(Boolean))];
    return {
      name: e.name,
      cat: normalize(e.category),
      terms: raw.map((t) => ({ raw: t, n: normalize(t), f: fuzzyKey(t) })),
    };
  });
}

/** 1 語の 得点 (0 = 一致なし) と 一致の 種類 */
function scoreTerm(t, qn, qf) {
  if (t.n === qn) return [100, 'exact'];
  if (t.n.startsWith(qn)) return [90, 'prefix'];
  if (t.n.includes(qn)) return [80, 'partial'];
  if (qf && t.f.includes(qf)) return [70, 'variant'];      // 長音・濁点 等の ゆれを 吸収して 一致
  const k = allowedTypos(qf.length);
  if (k && t.f.length) {
    const d = substringDistance(qf, t.f);
    if (d <= k) return [Math.round(40 + 29 * (1 - d / qf.length)), 'typo'];
  }
  return [0, null];
}

/**
 * あいまい検索。 一致度の 高い順に 返す。
 * @returns {{name: string, score: number, term: string, kind: 'exact'|'prefix'|'partial'|'variant'|'typo'|'category'}[]}
 */
export function search(index, q, { limit = Infinity } = {}) {
  const qn = normalize(q), qf = fuzzyKey(q);
  if (!qn) return [];
  const out = [];
  for (const e of index) {
    let best = [0, null, ''];
    for (const t of e.terms) {
      const [s, kind] = scoreTerm(t, qn, qf);
      // 同点なら 短い語 (より 本質的な 名前) を 優先
      if (s > best[0] || (s === best[0] && s && t.raw.length < best[2].length)) best = [s, kind, t.raw];
    }
    // 薬効分類名でも 引ける (例: DOAC)。 打ち間違い扱いの 一致 (最大 65) より 上、 名前の ゆれ一致 (70) より 下
    if (best[0] < 66 && e.cat.includes(qn)) best = [66, 'category', ''];
    if (best[0]) out.push({ name: e.name, score: best[0], term: best[2], kind: best[1] });
  }
  out.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name, 'ja'));
  return out.slice(0, limit);
}

// 2 文字ずつの 並びの 重なり (Dice 係数)。 「もしかして」 の 同点の 順位付けに 使う
function dice(a, b) {
  const grams = (s) => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1); } return g; };
  const ga = grams(a), gb = grams(b);
  let common = 0, total = 0;
  for (const [k, v] of ga) { common += Math.min(v, gb.get(k) ?? 0); total += v; }
  for (const v of gb.values()) total += v;
  return total ? (2 * common) / total : 0;
}

/** 何も 当たらない 時の 「もしかして」 候補 (打ち間違いを 多めに 許して 上位 n 件) */
export function suggest(index, q, n = 3) {
  const qf = fuzzyKey(q);
  if (qf.length < 3) return [];
  const k = Math.ceil(qf.length / 2);
  const cands = [];
  for (const e of index) {
    let best = null;
    for (const t of e.terms) {
      const d = substringDistance(qf, t.f);
      if (d > k) continue;
      const c = { name: e.name, term: t.raw, distance: d, sim: dice(qf, t.f) + (t.f[0] === qf[0] ? 0.2 : 0) };
      if (!best || d < best.distance || (d === best.distance && c.sim > best.sim)) best = c;
    }
    if (best) cands.push(best);
  }
  return cands
    .sort((a, b) => a.distance - b.distance || b.sim - a.sim || a.term.length - b.term.length)
    .slice(0, n)
    .map(({ name, term, distance }) => ({ name, term, distance }));
}
