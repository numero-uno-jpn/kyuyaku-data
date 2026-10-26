/*
 * 表示・比較用の日数を frontend/js/utils/daysBadge.js (日数の規則の唯一の実装) で計算して返す。
 * Python のスクリプト (backend/data/references/verification/_washout_days.py 経由) から呼ぶ。
 *
 * 標準入力の JSON → 標準出力の JSON:
 *   {"values": [[days, hours, day_of], ...]}
 *     → {"values": [{"eff": 比較用日数 | null, "text": 表示 | null}, ...]}  (effectiveDays / formatValue)
 *   {"drugs": [drug, ...]}  (drug_list.json の薬に surgery / contrast_ct.guideline_variations を付けたもの)
 *     → {"drugs": {一般名: {"high": [日数, 当日休薬か], "low": [...], "contrast": [...]}}}
 *       (effectiveValue。当日休薬が最長なら [null, true]、記載なしは [null, false])
 * 両方を 1 回で渡してもよい。
 */
const path = require('path')

globalThis.window = globalThis.window ?? {}
require(path.join(__dirname, '..', 'frontend', 'js', 'utils', 'daysBadge.js'))
const db = window.daysBadge

const SLOTS = { high: ['surgery', 'high'], low: ['surgery', 'low'], contrast: ['contrast_ct', 'contrast'] }

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { input += c })
process.stdin.on('end', () => {
  const req = JSON.parse(input || '{}')
  const out = {}
  if (req.values) {
    out.values = req.values.map(([days, hours, dayOf]) => ({
      eff: db.effectiveDays(days, hours, dayOf),
      text: db.formatValue(days, hours, dayOf),
    }))
  }
  if (req.drugs) {
    out.drugs = {}
    for (const d of req.drugs) {
      out.drugs[d.name] = Object.fromEntries(
        Object.entries(SLOTS).map(([slot, [kind, s]]) => {
          const v = db.effectiveValue(d, kind, s)
          return [slot, v === db.DAY_OF_RANK ? [null, true] : [v, false]]
        }))
    }
  }
  process.stdout.write(JSON.stringify(out))
})
