// 休薬情報データベース 検索サイト (ビルド不要・外部ライブラリなし)。 データは 同じサイトの v1/*.json。
const API = 'v1';
const ATTRIBUTION = '梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data';

const $ = (id) => document.getElementById(id);
const state = { drugs: [], byName: new Map(), lookup: [], meta: null, q: '', group: '', cache: new Map() };

// ---- 文字の 正規化 (全角/半角・ひらがな→カタカナ・小書き文字・空白・大文字小文字) ----
const SMALL_KANA = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };
const norm = (s) => (s ?? '').toString()
  .normalize('NFKC')
  .replace(/[\s　]/g, '')
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  .replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => SMALL_KANA[c] ?? c)
  .toLowerCase();

const esc = (s) => (s ?? '').toString()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// **強調** と 改行だけを 反映 (それ以外は エスケープ)
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
const plain = (s) => (s ?? '').toString().replace(/\*\*/g, '');
const days = (v) => (v === 0 ? '休薬不要' : v == null ? null : `${v} 日`);

// ---- 薬効分類の グループ (DokuWiki 版 検索ページと 同じ 規則) ----
function groupOf(c = '') {
  const has = (...ws) => ws.some((w) => c.includes(w));
  if (has('抗血小板', 'DOAC', '抗凝固')) return '抗血栓薬';
  if (has('SGLT2', 'DPP-4', 'SU薬', 'グリニド', 'グルコシダーゼ', 'GLP-1', 'GIP', 'ビグアナイド', '糖尿病', 'インスリン')) return '糖尿病薬';
  if (has('DMARD', '生物学的製剤', 'JAK', '免疫抑制')) return '抗リウマチ・免疫抑制薬';
  if (has('ホルモン', 'SERM', 'エストロゲン', '避妊', 'HRT')) return 'ホルモン・SERM';
  if (has('ビスホスホネート', 'RANKL', 'スクレロスチン')) return '骨粗鬆症薬';
  if (has('ACE', 'ARB', 'ARNI', '利尿')) return '降圧・利尿薬';
  if (has('抗がん', 'TKI', 'VEGF')) return '抗がん剤';
  if (has('PDE5')) return 'PDE5阻害薬';
  if (has('サプリ')) return 'サプリメント';
  if (has('MAO-B', '気分安定', '抗うつ', 'SSRI', '三環系', 'パーキンソン')) return '精神・神経系';
  return 'その他';
}

const DERIV = {
  direct: ['直接記載', 'ガイドラインが この薬の 値を 直接記載'],
  class: ['クラス推奨', 'ガイドラインは 薬効クラス単位で 推奨。 その値を この薬に 当てはめた'],
  derived: ['計算値', 'ガイドラインの 半減期 × N 倍 等の ルールから 作者が 計算した値'],
  external: ['他資料', 'この資料に 数値の 記載なし。 他の資料の 値'],
};

// ---- 休薬バッジ ----
function badgesOf(s = {}, c = {}) {
  const out = [];
  const hi = days(s.display_high_risk_days_before ?? s.surgery_high_risk_days_before);
  const lo = days(s.display_low_risk_days_before ?? s.surgery_low_risk_days_before);
  if (hi) out.push(['high', '周術期 (出血リスク高)', hi]);
  if (lo) out.push(['low', '周術期 (出血リスク低)', lo]);
  if (c.required) out.push(['ct', '造影CT', days(c.display_days_before ?? c.contrast_days_before) ?? '要休薬']);
  if (!out.length) out.push(['ok', '休薬', '記載なし']);
  return out;
}
const SHORT = { high: '周術期(高)', low: '周術期(低)', ct: '造影CT', ok: '休薬' };
const badgeHtml = (bs) => `<span class="badges">${bs.map(([k, , v]) => `<span class="badge ${k}">${esc(`${SHORT[k]} ${v}`)}</span>`).join('')}</span>`;

// ---- 一覧 ----
function search() {
  const q = norm(state.q);
  const hits = new Map();   // name → 一致した 別名 (一般名/分類で 一致なら '')
  if (q) {
    for (const d of state.drugs) {
      if (d._n.includes(q) || d._c.includes(q)) hits.set(d.name, '');
    }
    for (const [k, raw, names] of state.lookup) {
      if (!k.includes(q)) continue;
      for (const n of names) if (!hits.has(n)) hits.set(n, raw);
    }
  }
  return state.drugs
    .filter((d) => (!state.group || d._g === state.group) && (!q || hits.has(d.name)))
    .map((d) => [d, hits.get(d.name) ?? '']);
}

function renderGroups() {
  const counts = new Map();
  for (const d of state.drugs) counts.set(d._g, (counts.get(d._g) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1]);
  const chip = (name, label) =>
    `<button type="button" class="chip" data-group="${esc(name)}" aria-pressed="${state.group === name}">${esc(label)}</button>`;
  $('groups').innerHTML = chip('', `すべて (${state.drugs.length})`) + groups.map(([g, n]) => chip(g, `${g} (${n})`)).join('');
}

function renderList() {
  const rows = search();
  $('status').textContent = state.q || state.group ? `${rows.length} 件` : `全 ${state.drugs.length} 剤`;
  $('list').innerHTML = rows.length
    ? rows.map(([d, hit]) => `<li><a class="card" href="#/drugs/${encodeURIComponent(d.name)}">
        <span class="name">${esc(d.name)}</span>
        <span class="cat"> ${esc(d.category ?? '')}</span>
        ${hit ? `<div class="hit">「${esc(hit)}」に一致</div>` : ''}
        ${badgeHtml(badgesOf(d, { required: d.contrast_required, contrast_days_before: d.contrast_days_before }))}
      </a></li>`).join('')
    : '<li class="status">該当する薬剤がありません。 一般名・商品名の 一部でも 検索できます。</li>';
  for (const b of $('groups').querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.group === state.group));
}

// ---- 詳細 ----
async function loadDrug(name) {
  if (state.cache.has(name)) return state.cache.get(name);
  const d = state.byName.get(name);
  if (!d) return null;
  const r = await fetch(`${API}/${d.file}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const drug = (await r.json()).drug;
  state.cache.set(name, drug);
  return drug;
}

function quoteBlock(q, tr, loc) {
  if (!q && !loc) return '';
  return `<details><summary>根拠 (引用または抜粋)${loc ? ' と 所在' : ''}</summary>
    ${q ? `<blockquote>${esc(q)}</blockquote>` : ''}
    ${tr ? `<div class="tr">訳: ${esc(tr)}</div>` : ''}
    ${loc ? `<div class="loc">所在: ${esc(loc)}</div>` : ''}
  </details>`;
}

function variationsTable(vs, kind) {
  if (!vs?.length) return '';
  const head = kind === 'surgery'
    ? '<th scope="col">出典</th><th scope="col">高リスク</th><th scope="col">低リスク</th><th scope="col">値の出どころ / 備考</th>'
    : '<th scope="col">出典</th><th scope="col">日数</th><th scope="col">値の出どころ / 備考</th>';
  const rows = vs.map((v) => {
    const [dl, dt] = DERIV[v.value_derivation] ?? [];
    const src = v.source_url ? `<a href="${esc(v.source_url)}" rel="noopener">${esc(v.source)}</a>` : esc(v.source);
    const ver = v.version_label ? ` <span class="loc">(${esc(v.version_label)})</span>` : '';
    const nums = kind === 'surgery'
      ? `<td class="num">${esc(days(v.high_risk_days) ?? '—')}</td><td class="num">${esc(days(v.low_risk_days) ?? '—')}</td>`
      : `<td class="num">${esc(days(v.days) ?? '—')}</td>`;
    return `<tr><td>${src}${ver}${quoteBlock(v.quote_excerpt, null, v.source_location)}</td>${nums}
      <td>${dl ? `<span class="deriv" title="${esc(dt)}">${esc(dl)}</span> ` : ''}${esc(v.dose_dependent_summary ?? '')}</td></tr>`;
  }).join('');
  return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function infoText(d) {
  const s = d.surgery ?? {}, c = d.contrast_ct ?? {};
  const L = [`【${d.name}】${d.category ?? ''}`];
  const hi = days(s.display_high_risk_days_before), lo = days(s.display_low_risk_days_before);
  if (hi || lo) L.push(`周術期休薬: 高リスク ${hi ?? '—'} / 低リスク ${lo ?? '—'}`);
  if (c.required) L.push(`造影CT: ${days(c.display_days_before) ?? '要休薬'}`);
  if (s.note) L.push(`補足: ${plain(s.note)}`);
  const gv = d.guideline_variations?.surgery ?? [];
  if (gv.length) {
    L.push('ガイドライン別(周術期):');
    for (const v of gv) {
      let t = `  - ${v.source}`;
      if (v.high_risk_days != null || v.low_risk_days != null) t += `: 高${v.high_risk_days ?? '—'}日/低${v.low_risk_days ?? '—'}日`;
      if (v.dose_dependent_summary) t += ` (${v.dose_dependent_summary})`;
      L.push(t);
    }
  }
  if (d.references?.length) L.push(`出典: ${d.references.map((r) => `${r.source ?? ''}${r.url ? ` ${r.url}` : ''}`).join(' / ')}`);
  L.push('---', `${ATTRIBUTION} (CC BY 4.0) / 参考情報・最終判断は医療者の責任で`, location.href);
  return L.join('\n');
}

async function copy(text, btn, done) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.position = 'fixed'; ta.style.top = '-1000px';
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  const orig = btn.textContent; btn.textContent = done;
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

async function renderDetail(name) {
  const view = $('detail-view');
  view.innerHTML = '<p class="status">読み込み中…</p>';
  let d;
  try { d = await loadDrug(name); } catch { d = undefined; }
  if (!d) {
    view.innerHTML = `<a class="back" href="#/">← 一覧へ戻る</a><p>「${esc(name)}」は 見つかりませんでした。</p>`;
    return;
  }
  document.title = `${d.name} の休薬情報 — 休薬情報データベース`;
  const s = d.surgery ?? {}, c = d.contrast_ct ?? {};
  const boxes = badgesOf(s, c).map(([k, label, v]) =>
    `<div class="box ${k}"><div class="k">${esc(label)}</div><div class="v">${esc(v)}</div></div>`).join('');
  const names = [...(d.aliases ?? []), ...(d.brand_names ?? [])];
  const ex = (arr, label) => (arr?.length ? `<p class="hint">${label}: ${arr.map(esc).join('、 ')}</p>` : '');
  const refs = (d.references ?? []).map((r) => {
    const title = esc(`${r.source ? `[${r.source}] ` : ''}${r.title ?? r.url ?? ''}`);
    return `<li>${r.url ? `<a href="${esc(r.url)}" rel="noopener">${title}</a>` : title}
      ${r.year ? `<span class="loc"> (${esc(r.year)})</span>` : ''}
      ${quoteBlock(r.quote_excerpt, r.quote_translation_excerpt, r.location_in_source)}</li>`;
  }).join('');
  view.innerHTML = `<article class="detail">
    <a class="back" href="#/">← 一覧へ戻る</a>
    <h1>${esc(d.name)}</h1>
    <p class="cat">${esc(d.category ?? '')}</p>
    ${names.length ? `<p class="alias">別名・商品名: ${names.map(esc).join('、 ')}</p>` : ''}
    <div class="big">${boxes}</div>
    <p class="hint">表示の日数は 現行ガイドラインの 最長値 (安全側) です。 ガイドラインごとの値は 下の表を 参照してください。</p>
    ${s.note ? `<div class="note"><strong>周術期:</strong> ${md(s.note)}</div>` : ''}
    ${c.note ? `<div class="note"><strong>造影CT:</strong> ${md(c.note)}</div>` : ''}
    ${ex(s.high_risk_surgery_examples, '高リスク手術の例')}
    ${ex(s.low_risk_surgery_examples, '低リスク手術の例')}
    ${d.guideline_variations?.surgery?.length ? `<h2>ガイドライン別 (周術期)</h2>${variationsTable(d.guideline_variations.surgery, 'surgery')}` : ''}
    ${d.guideline_variations?.contrast_ct?.length ? `<h2>ガイドライン別 (造影CT)</h2>${variationsTable(d.guideline_variations.contrast_ct, 'contrast')}` : ''}
    ${refs ? `<h2>出典</h2><p class="hint">引用または抜粋は 一部、 参考資料・作者による注記を 含みます。 正確な記載は 原典で 確認してください。</p><ol class="refs">${refs}</ol>` : ''}
    <div class="actions">
      <button type="button" class="btn" id="copy-info">内容をコピー</button>
      <button type="button" class="btn secondary" id="copy-link">リンクをコピー</button>
    </div>
  </article>`;
  $('copy-info').addEventListener('click', (e) => copy(infoText(d), e.currentTarget, 'コピーしました'));
  $('copy-link').addEventListener('click', (e) => copy(location.href, e.currentTarget, 'コピーしました'));
}

// ---- ルーティング (#/ と #/drugs/{一般名}) ----
let lastScroll = 0;
async function route() {
  const m = location.hash.match(/^#\/drugs\/(.+)$/);
  const list = $('list-view'), detail = $('detail-view');
  if (m) {
    if (!list.hidden) lastScroll = window.scrollY;
    list.hidden = true; detail.hidden = false;
    await renderDetail(decodeURIComponent(m[1]));
    window.scrollTo(0, 0);
    $('main').focus({ preventScroll: true });
  } else {
    document.title = '休薬情報データベース (Kyuyaku Data)';
    detail.hidden = true; list.hidden = false;
    window.scrollTo(0, lastScroll);
  }
}

async function init() {
  $('status').textContent = '読み込み中…';
  try {
    const [meta, list, lookup] = await Promise.all(
      ['meta.json', 'drugs.json', 'lookup.json'].map((f) => fetch(`${API}/${f}`).then((r) => {
        if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        return r.json();
      })));
    state.meta = meta.meta;
    state.drugs = list.drugs.map((d) => ({ ...d, _n: norm(d.name), _c: norm(d.category), _g: groupOf(d.category ?? '') }));
    state.byName = new Map(state.drugs.map((d) => [d.name, d]));
    state.lookup = Object.entries(lookup.lookup).map(([k, names]) => [norm(k), k, names]);
  } catch (e) {
    $('status').textContent = `データの読み込みに 失敗しました (${e.message})。 時間をおいて 再読み込みしてください。`;
    return;
  }
  const m = state.meta ?? {};
  $('meta-line').textContent = `データ版 ${m.data_version ?? ''} (${m.data_updated_at ?? ''} 更新)・ 収載 ${state.drugs.length} 剤`;
  renderGroups();
  renderList();
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
  $('groups').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.group = state.group === b.dataset.group ? '' : b.dataset.group;
    renderList();
  });
  window.addEventListener('hashchange', route);
  await route();
}

init();
