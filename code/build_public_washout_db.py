# -*- coding: utf-8 -*-
"""
公開 API 用「休薬情報データベース」 (washout_public_v1.json) を生成する。

方針 (2026-07-26 確定):
- ライセンス CC BY 4.0 / 休薬情報のみ。
- drug_list.json + guideline_variations.json をマージし、公開して安全な field だけを抽出。
  → verbatim quote / 内部メモ / 内部マーカーは **構造的に除去** (再混入を生成時に防止)。
- 2026-10-18 追加: 根拠の透明性のため「短い引用」だけを quote_excerpt として出す
  (和文 300 / 英文 600 字以内。超過分は台帳 public_quote_excerpts.json の approved 抜粋、
  無ければ文の区切りで機械的に切る。ロジックは tools/public_quotes.py)。所在 (location) と PDF の #page=N 付き URL も出す。

入力: frontend/data/drug_list.json, frontend/data/guideline_variations.json,
      frontend/data/public_quote_excerpts.json (tools/prepare_quote_excerpts.py で準備)
出力: frontend/data/washout_public_v1.json  (静的配信 + PHP API が読むバルク artifact)

使い方:
  python tools/build_public_washout_db.py           # 生成
  python tools/build_public_washout_db.py --check   # commit 済みが最新か検査 (CI 用、generated_at は無視)
再生成は .githooks/pre-commit (drug_list / guideline_variations の stage 時) と
月次 KEGG sync workflow が自動で行い、data-checks CI (tools/run_data_checks.py) が不一致を検出する。
"""
import json
import os
import sys
import datetime

from public_quotes import load_excerpts, public_quote_fields, with_page, within_limit

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "backend", "data", "references", "verification"))
from _washout_days import effective_days as _eff, DAY_OF_RANK  # 比較・表示用日数の単一規則 (アプリと同じ)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(ROOT, "frontend", "data", "drug_list.json")
GV = os.path.join(ROOT, "frontend", "data", "guideline_variations.json")
OUT = os.path.join(ROOT, "frontend", "data", "washout_public_v1.json")
GL_DIR = os.path.join(ROOT, "backend", "data", "references", "guidelines", "extracted")

# --- 公開してよい variation field (値 + 出典ラベル + 派生サマリのみ。短い引用・所在・URL は _public_variations で付加) ---
# 除外: note / purpose / quote / quote_verbatim / _manual / _note_* / dose_dependent_is_complex 等
# *_hours: 原文が時間の値 (日数は null)。*_day_of / day_of: 原文が「手術当日の休薬」 (日数は null)
VAR_SURGERY_KEEP = ["source", "high_risk_days", "low_risk_days", "high_risk_hours", "low_risk_hours",
                    "high_risk_day_of", "low_risk_day_of", "value_derivation",
                    "dose_dependent_summary", "version_label", "version_year"]
VAR_CONTRAST_KEEP = ["source", "days", "hours", "day_of", "value_derivation", "dose_dependent_summary",
                     "version_label", "version_year"]
# 参照の citation field (quote / quote_translation はそのまま出さず、_public_reference で短い引用に置換)
REF_KEEP = ["source", "title", "url", "verification_status", "year", "author_interpretation"]


def _pick(d, keys):
    return {k: d[k] for k in keys if d.get(k) is not None}


def load_gl_titles():
    """GL id → 正式名 (抽出 YAML 先頭の title:)。略称の source だけでは何の文書か分からないため併記用。
    kegg-sync CI に PyYAML が無いので、トップレベルの 1 行スカラーだけを読む。"""
    titles = {}
    for f in sorted(os.listdir(GL_DIR)):
        if not f.endswith(".yaml") or f.startswith("_") or ".independent." in f or ".primary." in f:
            continue
        gid = title = None
        for line in open(os.path.join(GL_DIR, f), encoding="utf-8"):
            key, sep, val = line.rstrip("\r\n").partition(":")
            if not sep or key not in ("guideline_id", "title"):
                continue
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] == "'":
                val = val[1:-1].replace("''", "'")
            elif len(val) >= 2 and val[0] == val[-1] == '"':
                val = val[1:-1]
            if key == "guideline_id":
                gid = gid or val
            else:
                title = title or val
            if gid and title:
                break
        if gid and title:
            titles[gid] = title
    return titles


# --- アプリの daysBadge.js と同じ「表示推奨値」を算出 ---
# 優先: 現行 series の GL 最大値 > PMDA 最大値 > drug_list master (安全側=長い方)
def _is_pmda(v):
    return "PMDA" in (v.get("source") or "")


def _filter_current_series(vs):
    """同じ系列の旧版を除く。現行の年は series_latest_year (系列全体で値の入った最新の版) を優先し、
    無い古いデータではこの薬の variations の最大 version_year を使う。"""
    latest = {}
    for v in vs:
        sid, yr = v.get("series_id"), v.get("version_year")
        if sid and isinstance(yr, (int, float)):
            latest[sid] = max(latest.get(sid, yr), yr, v.get("series_latest_year") or yr)
    out = []
    for v in vs:
        sid = v.get("series_id")
        if sid and sid in latest:
            if v.get("version_year") == latest[sid]:
                out.append(v)
        else:
            out.append(v)
    return out


# slot → (日数 key, 時間 key, 当日休薬 key)
SLOT_KEYS = {
    "high": ("high_risk_days", "high_risk_hours", "high_risk_day_of"),
    "low": ("low_risk_days", "low_risk_hours", "low_risk_day_of"),
    "contrast": ("days", "hours", "day_of"),
}


def _nums(vs, slot):
    dk, hk, ok = SLOT_KEYS[slot]
    out = []
    for v in vs:
        e = _eff(v.get(dk), v.get(hk), bool(v.get(ok)))
        if e is not None:
            out.append(e)
    return out


def effective_days(variations, master, slot, master_day_of=False):
    """daysBadge 相当: 現行GL最大 > PMDA最大 > master。全て無ければ None。
    比較は _washout_days.effective_days (時間は日数に切り上げ、当日休薬は 0.5)。
    master_day_of: drug_list 本体の当日休薬の印 (このとき master は None)。
    戻り値 (日数, 当日休薬か): 当日休薬が最長のときは (None, True)。"""
    variations = variations or []
    gl = _nums(_filter_current_series([v for v in variations if not _is_pmda(v)]), slot)
    pm = _nums([v for v in variations if _is_pmda(v)], slot)
    best = max(gl) if gl else (max(pm) if pm else None)
    if best is None:
        return (None, True) if master_day_of else (master, False)
    if best == DAY_OF_RANK:
        return None, True
    return (int(best) if float(best).is_integer() else best), False


def _public_variations(gv_entry, keep, entries, warnings, gl_titles):
    out = []
    for v in (gv_entry or []):
        rec = _pick(v, keep)
        if rec.get("source"):
            if gl_titles.get(v.get("_gl_id")):
                rec["source_title"] = gl_titles[v["_gl_id"]]
            q, page = public_quote_fields(v.get("source"), v.get("quote"), None, entries, warnings)
            rec.update(q)
            if v.get("source_location"):
                rec["source_location"] = v["source_location"]
            if v.get("source_url"):
                rec["source_url"] = with_page(v["source_url"], page)
            out.append(rec)
    return out


def _public_reference(r, entries, warnings):
    rec = _pick(r, REF_KEEP)
    q, page = public_quote_fields(r.get("source"), r.get("quote"), r.get("quote_translation"),
                                  entries, warnings)
    rec.update(q)
    if r.get("location_in_source"):
        rec["location_in_source"] = r["location_in_source"]
    if rec.get("url"):
        rec["url"] = with_page(rec["url"], page)
    return rec


def build(warnings=None):
    """drug_list + guideline_variations から公開 DB の dict を組み立てる (書き出しはしない)。
    warnings (dict) を渡すと未承認で引用を出さなかった件数等を記録する。"""
    if warnings is None:
        warnings = {}
    dl = json.load(open(DL, encoding="utf-8"))
    gv = json.load(open(GV, encoding="utf-8"))
    gv_drugs = gv.get("drugs", {})
    gl_titles = load_gl_titles()
    entries = load_excerpts().get("entries", {})

    drugs_out = []
    for d in dl["drugs"]:
        name = d.get("name")
        surg = d.get("surgery") or {}
        cont = d.get("contrast_ct") or {}
        gentry = gv_drugs.get(name, {})
        _hi = effective_days(gentry.get("surgery"), surg.get("high_risk_days_before"), "high",
                             bool(surg.get("high_risk_day_of")))
        _lo = effective_days(gentry.get("surgery"), surg.get("low_risk_days_before"), "low",
                             bool(surg.get("low_risk_day_of")))
        _co = effective_days(gentry.get("contrast_ct"), cont.get("days_before"), "contrast",
                             bool(cont.get("day_of")))

        rec = {
            "name": name,
            "category": d.get("category"),
            "aliases": d.get("aliases") or [],
            "brand_names": d.get("brand_names") or [],
            "generic_brands": d.get("generic_brands") or [],
            # 周術期休薬 (drug_list の note は作者による解説 = 公開可)
            "surgery": {
                "required": surg.get("required"),
                # master (drug_list の primary 採用値)
                "high_risk_days_before": surg.get("high_risk_days_before"),
                "low_risk_days_before": surg.get("low_risk_days_before"),
                "high_risk_day_of": bool(surg.get("high_risk_day_of")),
                "low_risk_day_of": bool(surg.get("low_risk_day_of")),
                # 表示推奨値 (アプリのバッジ相当: 現行GL最大 = 安全側)。consumer はこれを使うと安全
                "display_high_risk_days_before": _hi[0],
                "display_high_risk_day_of": _hi[1],
                "display_low_risk_days_before": _lo[0],
                "display_low_risk_day_of": _lo[1],
                "high_risk_surgery_examples": surg.get("high_risk_surgery_examples") or [],
                "low_risk_surgery_examples": surg.get("low_risk_surgery_examples") or [],
                "note": surg.get("note"),
                # 作者による根拠の解釈 (原典の記述ではない。見直した剤のみ、他は null)
                "author_interpretation": surg.get("author_interpretation"),
            },
            "contrast_ct": {
                "required": cont.get("required"),
                "days_before": cont.get("days_before"),
                "day_of": bool(cont.get("day_of")),
                "display_days_before": _co[0],
                "display_day_of": _co[1],
                "note": cont.get("note"),
            },
            # ガイドライン別 washout (値 + 出典ラベル + 短い引用 + 所在。全文 quote / note は含めない)
            "guideline_variations": {
                "surgery": _public_variations(gentry.get("surgery"), VAR_SURGERY_KEEP, entries, warnings, gl_titles),
                "contrast_ct": _public_variations(gentry.get("contrast_ct"), VAR_CONTRAST_KEEP, entries, warnings, gl_titles),
            },
            # 出典 (source/title/url/検証status + 短い引用 + 所在。全文 quote は無し)
            "references": [_public_reference(r, entries, warnings) for r in (d.get("references") or [])],
        }
        drugs_out.append(rec)

    out = {
        "_meta": {
            "name": "休薬情報データベース (Kyuyaku Data)",
            "author": "梅谷 直亨 (Naoyuki Umetani)",
            "api_version": "1.1",
            "data_version": dl.get("version"),
            "data_updated_at": dl.get("updated_at"),
            "generated_at": datetime.date.today().isoformat(),
            "scope": "周術期・造影CT の休薬情報のみ",
            "drug_count": len(drugs_out),
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "license_exceptions": "quote_excerpt / quote_translation_excerpt は CC BY 4.0 の対象外です。各出典 (学会ガイドライン / PMDA 添付文書等) の著作物を著作権法 32 条に基づき引用したもので、著作権は各権利者に帰属します。再利用する場合は出典を明示し、各権利者の条件に従ってください。",
            "attribution": "梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data",
            "disclaimer": "本データは意思決定支援のための参考情報です。最終的な休薬判断は医療者の責任で行ってください。内容は無保証で、継続的に更新されます。",
            "verbatim_quotes": "quote_excerpt は一次資料 (学会GL / PMDA添付文書等) からの引用または抜粋です (一部、参考資料・作者による注記を含みます。極端に長いものは抜粋、' … ' は中略)。正確な記載は location_in_source / source_location と url / source_url (PDF は該当頁に移動) で原典を確認してください。",
            "value_semantics": "high_risk_days_before 等は作者の採用値 (primary)。display_* は現行GLの最長値 (安全側) — 消費側は display_* の使用を推奨。各GLの個別値は guideline_variations 参照。日数は 0 = 休薬不要、null = 記載なし。*_day_of / day_of: true は「手術当日の休薬」 (前日まで服用可、日数は null。作者の採用値の high_risk_day_of 等も同じ)。*_hours は原文が時間の値 (日数は null)。display_* では時間を日数に切り上げ (手術時刻が動くため前日から休薬する扱い)、当日休薬は 0 日より長く 1 日より短いとして比較。",
            "source_of_truth": "https://github.com/numero-uno-jpn/kyuyaku-data",
        },
        "drugs": drugs_out,
    }
    return out


def _iter_excerpts(drug):
    for r in drug.get("references") or []:
        if r.get("quote_excerpt"):
            yield r["quote_excerpt"]
    for k in ("surgery", "contrast_ct"):
        for v in (drug.get("guideline_variations") or {}).get(k) or []:
            if v.get("quote_excerpt"):
                yield v["quote_excerpt"]


def _without_generated_at(db):
    """比較用: 実行日で毎回変わる _meta.generated_at を除いたコピー。"""
    db = dict(db)
    db["_meta"] = {k: v for k, v in (db.get("_meta") or {}).items() if k != "generated_at"}
    return db


def check(out):
    """--check: commit 済み OUT が現在の入力から再生成した内容と一致するか (generated_at は除外)。"""
    if not os.path.exists(OUT):
        print(f"✗ {os.path.relpath(OUT, ROOT)} が無い", file=sys.stderr)
        return 1
    cur = json.load(open(OUT, encoding="utf-8"))
    if _without_generated_at(cur) == _without_generated_at(out):
        print(f"✓ 公開 DB は最新 ({os.path.relpath(OUT, ROOT)}, {len(out['drugs'])} 剤)")
        return 0
    old_by = {d.get("name"): d for d in cur.get("drugs", [])}
    new_by = {d.get("name"): d for d in out["drugs"]}
    diff = sorted(n for n in set(old_by) | set(new_by) if old_by.get(n) != new_by.get(n))
    print(f"✗ 公開 DB が入力 (drug_list / guideline_variations) と不一致: {len(diff)} 剤", file=sys.stderr)
    for n in diff[:30]:
        print(f"    - {n}", file=sys.stderr)
    if _without_generated_at(cur)["_meta"] != _without_generated_at(out)["_meta"]:
        print("    - (_meta)", file=sys.stderr)
    print("  再生成: python tools/build_public_washout_db.py → washout_public_v1.json を commit", file=sys.stderr)
    return 1


def main():
    warnings = {}
    try:
        out = build(warnings)
    except ValueError as ex:  # 台帳の抜粋が原文と不一致等
        print(f"✗ {ex}", file=sys.stderr)
        return 1

    # 安全確認: 公開データに verbatim/内部 field が混入していないか (混入時は書き出さずに異常終了)
    blob = json.dumps(out, ensure_ascii=False)
    leaked = [k for k in ("quote", "quote_verbatim", "quote_translation", "_manual",
                          "_note_original", "_note_reextracted", "_pmda_class")
              if f'"{k}"' in blob]
    if leaked:
        print(f"✗ 除去すべき field が残存: {leaked}", file=sys.stderr)
        return 1
    over = [e for d in out["drugs"] for e in _iter_excerpts(d) if not within_limit(e)]
    if over:
        print(f"✗ 上限超過の quote_excerpt: {len(over)} 件 (例: {over[0][:40]})", file=sys.stderr)
        return 1

    if "--check" in sys.argv:
        return check(out)

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(OUT, "a", encoding="utf-8").write("\n")
    print(f"✓ 生成: {os.path.relpath(OUT, ROOT)} ({len(out['drugs'])} 剤)")
    print("  ✓ verbatim quote / 内部 field の混入なし、quote_excerpt は全件上限内")
    if warnings.get("cut"):
        print(f"  ⓘ 上限超過で文の区切りで切った引用: {warnings['cut']} 件 (承認済みの抜粋がある引用はそれを使用)")
    if warnings.get("translation_over"):
        print(f"  ⓘ 和訳が和文上限を超えるため和訳を省略: {warnings['translation_over']} 件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
