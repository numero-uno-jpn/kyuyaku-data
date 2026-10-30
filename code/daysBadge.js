/**
 * 休薬日数バッジの表示ロジック (3 層構造: GL > PMDA 添付文書 > drug_list)。
 * 表示・比較用の日数の規則の唯一の実装。公開データ (washout_public_v1.json の display_*) と
 * ガイドライン値の用量別の要約も、Python から tools/washout_days.cjs 経由でここを呼ぶ。
 *
 * 表示規則:
 *   - GL 値あり           → GL 値を表示 (複数 GL で相違 → 最長値)
 *   - GL 値がクラス単位のものだけ + 添付文書が日数を明記 (days_explicit) して長い → 添付文書の値
 *   - GL 値なし + PMDA 値 → PMDA 値を表示
 *   - どちらもなし          → drug_list 値 (フォールバック)
 *   - user override あり    → `Nday✏` (鉛筆マーク)
 *   - GL ≠ PMDA            → バッジに PMDA 値も併記 tooltip で表示
 *
 * 公開 API (window.daysBadge):
 *   daysBadge(drug, kind, slot)
 *     → { value, prefix, suffix, reason, glValues, pmdaValues, hasGlPmdaConflict }
 *   formatDaysValue(value, opts?)
 *   formatBadge(drug, kind, slot)
 *   effectiveValue(drug, kind, slot) → バッジと同じ比較用日数 (指示書・絞り込み用)
 *   masterValue(obj, kind, slot)     → drug_list (または上書きの snapshot) の比較用日数
 *   badgeTooltip(drug, kind, slot)
 *   combineTip(baseTip, drug, kind, slot)
 *   hasOverride(drug, kind, slot)
 *   hasGlDifference(drug)            → ⚖ GL差 (採用値と異なる日数のガイドラインがある)
 *   colorClass(value, cls)           → 日数 0 (継続可) なら緑 (CONTINUE_CLS)、それ以外は cls
 */
(function () {
  const KIND_KEYS = {
    surgery: {
      high: { dataKey: 'high_risk_days_before', variationKey: 'high_risk_days', hoursKey: 'high_risk_hours', dayOfKey: 'high_risk_day_of' },
      low:  { dataKey: 'low_risk_days_before',  variationKey: 'low_risk_days',  hoursKey: 'low_risk_hours',  dayOfKey: 'low_risk_day_of'  },
    },
    contrast_ct: {
      contrast: { dataKey: 'days_before', variationKey: 'days', hoursKey: 'hours', dayOfKey: 'day_of' },
    },
  }

  /*
   * 比較・表示用の日数 (単一規則)。Python のスクリプトも tools/washout_days.cjs 経由でここを使う。
   * 規則の表は tests/unit/fixtures/washout_days_cases.json。
   *   - 当日休薬 (day_of: 原文が「手術当日の休薬」) → 比較 0.5 日 (継続 0 < 当日 < 1 日)、表示「当日休薬」
   *   - 日数あり → その日数 (0 = 継続可)
   *   - 時間だけ → 日数に切り上げ (12h → 1 日、36h → 2 日)。手術時刻が当日動くため前日から休薬する実務に合わせる
   */
  const DAY_OF_RANK = 0.5
  const DAY_OF_LABEL = '当日休薬'

  function _isNum(x) { return typeof x === 'number' && !isNaN(x) }

  function effectiveDays(days, hours, dayOf) {
    if (dayOf) return DAY_OF_RANK
    if (_isNum(days)) return days
    if (_isNum(hours)) return hours > 0 ? Math.ceil(hours / 24) : 0
    return null
  }

  function formatValue(days, hours, dayOf) {
    if (dayOf) return DAY_OF_LABEL
    if (_isNum(days)) return days === 0 ? '継続可' : `${days}日`
    if (_isNum(hours)) return hours === 0 ? '継続可' : `${Math.ceil(hours / 24)}日 (${hours}時間)`
    return null
  }

  function _keys(kind, slot) {
    return KIND_KEYS[kind]?.[slot]
  }

  /**
   * drug_list 本体 (または上書きの _baseSnapshot) の比較用日数。
   * 本体の当日休薬は surgery.high_risk_day_of / low_risk_day_of / contrast_ct.day_of (日数は null)。
   * obj は drug そのものか、{ surgery: {...} } 形の snapshot。
   */
  function masterValue(obj, kind, slot) {
    const k = _keys(kind, slot)
    const src = obj?.[kind]
    return k ? effectiveDays(src?.[k.dataKey], null, src?.[k.dayOfKey]) : null
  }

  function hasOverride(drug, kind, slot) {
    return !!(drug?._isCustom && !drug?._isAddition && drug?._baseSnapshot?.[kind])
  }

  /**
   * 同系列内で最新版のみ残す (旧版 GL の値を badge 集計から除外)。
   * 現行の年は series_latest_year (系列全体で値の入った最新の版) を優先する。
   * 薬ごとの最大 version_year だけでは、新しい版から外れた薬で旧版が「現行」扱いになるため。
   */
  function filterCurrentSeriesOnly(variations) {
    if (!Array.isArray(variations)) return []
    const bySeriesLatest = new Map()
    for (const v of variations) {
      const sid = v?.series_id
      const yr = typeof v?.version_year === 'number' ? v.version_year : null
      if (!sid || yr == null) continue
      const seriesYr = typeof v?.series_latest_year === 'number' ? v.series_latest_year : yr
      const prev = bySeriesLatest.get(sid)
      bySeriesLatest.set(sid, Math.max(prev ?? -Infinity, yr, seriesYr))
    }
    return variations.filter(v => {
      const sid = v?.series_id
      if (!sid) return true
      return v?.version_year === bySeriesLatest.get(sid)
    })
  }

  /** PMDA 添付文書 variation かどうか。*/
  function isPmda(variation) {
    return !!(variation?.source?.includes('PMDA') || variation?._source === 'pmda_package_insert')
  }

  /** この slot に値を持つ GL variation がすべてクラス単位の推奨 (value_derivation: class) か。*/
  function isClassOnly(variations, k) {
    const withValue = (variations || []).filter(v => effectiveDays(v?.[k?.variationKey], v?.[k?.hoursKey], v?.[k?.dayOfKey]) != null)
    return withValue.length > 0 && withValue.every(v => v?.value_derivation === 'class')
  }

  /** variations 配列から比較用日数 (日数 / 時間の切り上げ / 当日休薬 0.5) を unique 収集。*/
  function collectNums(variations, k) {
    const nums = []
    for (const v of (variations || [])) {
      const val = effectiveDays(v?.[k?.variationKey], v?.[k?.hoursKey], v?.[k?.dayOfKey])
      if (val != null) nums.push(val)
    }
    return [...new Set(nums)]
  }

  /** 時間で書かれた値 (日数なし) の原文表記一覧 (tooltip 用)。例: ['48時間'] */
  function collectHourNotes(variations, k) {
    const notes = []
    for (const v of (variations || [])) {
      if (!v?.[k?.dayOfKey] && !_isNum(v?.[k?.variationKey]) && _isNum(v?.[k?.hoursKey]) && v[k.hoursKey] > 0) {
        notes.push(`${v[k.hoursKey]}時間`)
      }
    }
    return [...new Set(notes)]
  }

  /**
   * 3 層バッジ表示ロジック。
   *
   * @returns {{
   *   value: number|null,
   *   prefix: string,
   *   suffix: string,
   *   reason: 'override'|'multi'|'single'|'pmda'|'fallback'|'none',
   *   glValues: number[],
   *   pmdaValues: number[],
   *   hasGlPmdaConflict: boolean,
   * }}
   */
  function daysBadge(drug, kind, slot) {
    const k = _keys(kind, slot)
    const currentValue = masterValue(drug, kind, slot)
    const allVariations = drug?.[kind]?.guideline_variations || []

    // 分離: GL (非 PMDA) vs PMDA
    const glVariations   = filterCurrentSeriesOnly(allVariations.filter(v => !isPmda(v)))
    const pmdaVariations = allVariations.filter(v => isPmda(v))

    const glValues   = collectNums(glVariations, k)
    const pmdaValues = collectNums(pmdaVariations, k)
    // 時間で書かれた値の原文表記 (日数に切り上げて表示するので tooltip で原文を示す)。
    // バッジの値を決める層 (GL があれば GL、なければ添付文書) から集める
    const hourNotes  = collectHourNotes(glValues.length ? glVariations : pmdaVariations, k)

    // user override
    if (hasOverride(drug, kind, slot)) {
      return { value: currentValue, prefix: '', suffix: '✏', reason: 'override', uniqueValues: glValues, glValues, pmdaValues, hasGlPmdaConflict: false, hourNotes }
    }

    // methodology 5.1 の原則: 現行 GL の値がクラス単位のものだけで、
    // 添付文書が薬剤名で日数を明記している (days_explicit) 場合は、長い方を表示する
    if (glValues.length && isClassOnly(glVariations, k)) {
      const explicitValues = collectNums(pmdaVariations.filter(v => v?.days_explicit), k)
      const maxGl = Math.max(...glValues)
      if (explicitValues.length && Math.max(...explicitValues) > maxGl) {
        return { value: Math.max(...explicitValues), prefix: '', suffix: '', reason: 'label_over_class', uniqueValues: glValues, glValues, pmdaValues, hasGlPmdaConflict: true, hourNotes: collectHourNotes(pmdaVariations, k) }
      }
    }

    // 層 1: GL 値
    if (glValues.length >= 2) {
      const maxGl = Math.max(...glValues)
      const conflict = pmdaValues.length > 0 && !pmdaValues.includes(maxGl)
      return { value: maxGl, prefix: '～', suffix: '', reason: 'multi', uniqueValues: glValues, glValues, pmdaValues, hasGlPmdaConflict: conflict, hourNotes }
    }
    if (glValues.length === 1) {
      const conflict = pmdaValues.length > 0 && !pmdaValues.includes(glValues[0])
      return { value: glValues[0], prefix: '', suffix: '', reason: 'single', uniqueValues: glValues, glValues, pmdaValues, hasGlPmdaConflict: conflict, hourNotes }
    }

    // 層 2: PMDA 値 (GL なし) — reason='single' で tooltip は badgeTooltip 内で分岐
    if (pmdaValues.length >= 2) {
      return { value: Math.max(...pmdaValues), prefix: '', suffix: '', reason: 'single', uniqueValues: pmdaValues, glValues: [], pmdaValues, hasGlPmdaConflict: false, hourNotes }
    }
    if (pmdaValues.length === 1) {
      return { value: pmdaValues[0], prefix: '', suffix: '', reason: 'single', uniqueValues: pmdaValues, glValues: [], pmdaValues, hasGlPmdaConflict: false, hourNotes }
    }

    // 層 3: drug_list フォールバック
    if (currentValue == null) {
      return { value: null, prefix: '', suffix: '', reason: 'none', uniqueValues: [], glValues: [], pmdaValues: [], hasGlPmdaConflict: false, hourNotes }
    }
    return { value: currentValue, prefix: '', suffix: '', reason: 'single', uniqueValues: [], glValues: [], pmdaValues: [], hasGlPmdaConflict: false, hourNotes }
  }

  /** 比較用日数 → 表示ラベル (0 = 継続可、0.5 = 当日休薬、null = 未定、else = 'N日')。*/
  function formatDaysValue(value, opts) {
    opts = opts || {}
    if (value == null || value === '') return opts.emptyText != null ? opts.emptyText : '未定'
    if (value === 0) return opts.zeroText != null ? opts.zeroText : '継続可'
    if (value === DAY_OF_RANK) return DAY_OF_LABEL
    return `${value}日`
  }

  /** 時間で書かれた値を日数に切り上げている旨の説明 (なければ '')。*/
  function hourNoteText(b) {
    if (!b?.hourNotes?.length) return ''
    return `時間で書かれた資料の値 (原文: ${b.hourNotes.join(' / ')}) は日数に切り上げて表示 (手術時刻が動くため前日から休薬する扱い)。`
  }

  /** 当日休薬の説明 (バッジが当日休薬のとき)。*/
  function dayOfNoteText(b, kind) {
    const target = kind === 'contrast_ct' ? '造影' : '手術'
    return b?.value === DAY_OF_RANK ? `${target}当日は服用しない (前日まで服用可)。` : ''
  }

  /** バッジと同じ比較用日数 (数値 / 0.5 = 当日休薬 / null)。休薬指示書と処置別の絞り込みはこれを使う。*/
  function effectiveValue(drug, kind, slot) {
    return daysBadge(drug, kind, slot).value
  }

  /*
   * 手術時の休薬が必要 (surgery.required) なのに高リスクの日数がどの層にもない剤。
   * 高リスクのバッジを出さないと低リスクの「継続可」だけが目立ち、続けてよい薬に見えるため
   * 「高日数なし」を出す (例: マルスタシマブ = 添付文書は大手術で投与中止、日数の記載なし)。
   * dental_consideration 剤 (BP・デノスマブ等) は独自バッジなので対象外。
   */
  const NO_DAYS_LABEL = '日数なし'
  const NO_DAYS_TIP = '一次資料に高リスク手術の休薬日数の記載がありません。補足 (周術期)・作者解釈・出典を確認し、処方医と相談してください。'

  function isHighNoDays(drug) {
    return !!drug?.surgery?.required && !drug.surgery.dental_consideration
      && effectiveValue(drug, 'surgery', 'high') == null
  }

  /*
   * ⚖ GL差: 現行版のガイドラインの値に、採用値 (バッジと同じ日数) と異なるものがある剤。
   * 手術の高・低リスクと造影 CT のどれか 1 つであれば対象。添付文書との差は日数バッジの tooltip で示すので含めない
   */
  const GL_DIFF_SLOTS = [['surgery', 'high'], ['surgery', 'low'], ['contrast_ct', 'contrast']]

  function hasGlDifference(drug) {
    return GL_DIFF_SLOTS.some(([kind, slot]) => {
      const b = daysBadge(drug, kind, slot)
      return b.glValues.some(v => v !== b.value)
    })
  }

  /*
   * 継続可 (日数 0) の色。バッジもカードも、休薬の対象外の「継続可」と同じ緑にそろえる。
   * cls は日数があるときの色 (高 = 赤、低 = ピンク、造影 = 橙)。
   */
  const CONTINUE_CLS = 'bg-emerald-100 text-emerald-900 border border-emerald-300'

  function colorClass(value, cls) {
    return value === 0 ? CONTINUE_CLS : cls
  }

  /** バッジテキスト。例: '～7日'、'3日✏'、'14日 (PMDA)'。*/
  function formatBadge(drug, kind, slot, opts) {
    const b = daysBadge(drug, kind, slot)
    if (b.value == null) return (opts && opts.emptyText) != null ? opts.emptyText : ''
    return `${b.prefix}${formatDaysValue(b.value, opts)}${b.suffix}`
  }

  /** v-tooltip 用説明文。GL-PMDA 差異を含む。*/
  function badgeTooltip(drug, kind, slot) {
    const b = daysBadge(drug, kind, slot)
    const original = masterValue(drug?._baseSnapshot, kind, slot)

    if (b.reason === 'override') {
      return `**自施設で編集された値** です (元推奨値: ${formatDaysValue(original)})。`
    }
    if (b.reason === 'multi') {
      const list = b.glValues.slice().sort((a, c) => a - c).map(v => formatDaysValue(v)).join(' / ')
      let tip = `複数ガイドラインの値: **${list}**。バッジは最長値 (安全側) を表示。`
      if (b.hasGlPmdaConflict) {
        const pmdaList = b.pmdaValues.map(v => formatDaysValue(v)).join(' / ')
        tip += `<br><br>⚠ PMDA 添付文書の休薬期間: **${pmdaList}**。ガイドラインの値と異なるため併記。`
      }
      return tip
    }
    if (b.reason === 'single') {
      // PMDA のみのケース (glValues 空、pmdaValues あり)
      if (b.glValues.length === 0 && b.pmdaValues.length > 0) {
        const list = b.pmdaValues.map(v => formatDaysValue(v)).join(' / ')
        return `PMDA 添付文書由来の目安値: **${list}**。(本薬剤に適用されるガイドラインは未確認)`
      }
      // GL 単一 + PMDA 衝突あり
      if (b.hasGlPmdaConflict) {
        const pmdaList = b.pmdaValues.map(v => formatDaysValue(v)).join(' / ')
        return `ガイドライン由来の目安値。<br><br>⚠ PMDA 添付文書の休薬期間: **${pmdaList}**。ガイドラインの値と異なるため併記。`
      }
      return '資料 (ガイドライン / 添付文書) 由来の目安値。'
    }
    if (b.reason === 'label_over_class') {
      const glList = b.glValues.slice().sort((a, c) => a - c).map(v => formatDaysValue(v)).join(' / ')
      return `ガイドラインは薬効クラス単位の値 (**${glList}**) だけのため、薬剤名で日数を明記した PMDA 添付文書の **${formatDaysValue(b.value)}** を表示。`
    }
    if (b.reason === 'pmda') {
      const list = b.pmdaValues.map(v => formatDaysValue(v)).join(' / ')
      return `PMDA 添付文書由来の目安値: **${list}**。(本薬剤に適用されるガイドラインは未確認)`
    }
    return ''
  }

  /** 既存 tip (risk profile 由来) に badge 由来説明を append。*/
  function combineTip(baseTip, drug, kind, slot) {
    const b = daysBadge(drug, kind, slot)
    // 当日休薬 / 時間の切り上げの説明はどの場合も付ける
    const notes = [dayOfNoteText(b, kind), hourNoteText(b)].filter(Boolean).join('<br>')
    const join = (...parts) => parts.filter(Boolean).join('<br><br>')
    const extra = badgeTooltip(drug, kind, slot)
    if (!extra || b.reason === 'none') return join(baseTip, notes)
    // single + GL 単独 (PMDA なし、drug_list フォールバックでもない) → baseTip のまま
    if (b.reason === 'single' && b.glValues.length >= 1 && !b.hasGlPmdaConflict) return join(baseTip, notes)
    // single + PMDA のみ or drug_list フォールバック or PMDA conflict → extra を追加
    return join(baseTip, extra, notes)
  }

  window.daysBadge = {
    daysBadge,
    effectiveValue,
    masterValue,
    effectiveDays,
    formatValue,
    DAY_OF_RANK,
    formatDaysValue,
    formatBadge,
    badgeTooltip,
    combineTip,
    hasOverride,
    isPmda,
    isHighNoDays,
    hasGlDifference,
    NO_DAYS_LABEL,
    NO_DAYS_TIP,
    CONTINUE_CLS,
    colorClass,
  }
})()
