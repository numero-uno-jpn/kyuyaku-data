# -*- coding: utf-8 -*-
"""
公開 API 用 「休薬情報データベース」 (washout_public_v1.json) を生成する。

方針 (2026-07-26 確定):
- ライセンス CC BY 4.0 / 休薬情報のみ。
- drug_list.json + guideline_variations.json を マージし、 公開して 安全な field だけを 抽出。
  → verbatim quote / 内部メモ / 内部マーカー は **構造的に 除去** (再混入を 生成時に 防止)。
- 2026-10-18 追加: 根拠の 透明性の ため 「短い引用」 だけを quote_excerpt として 出す
  (和文 300 / 英文 600 字 以内。 超過分は 台帳 public_quote_excerpts.json の approved 抜粋のみ。
  ロジックは tools/public_quotes.py)。 所在 (location) と PDF の #page=N 付き URL も 出す。

入力: frontend/data/drug_list.json, frontend/data/guideline_variations.json,
      frontend/data/public_quote_excerpts.json (tools/prepare_quote_excerpts.py で 準備)
出力: frontend/data/washout_public_v1.json  (静的配信 + PHP API が 読む バルク artifact)

使い方:
  python tools/build_public_washout_db.py           # 生成
  python tools/build_public_washout_db.py --check   # commit 済みが 最新か 検査 (CI 用、 generated_at は 無視)
再生成は .githooks/pre-commit (drug_list / guideline_variations の stage 時) と
月次 KEGG sync workflow が 自動で行い、 gl-variation-integrity CI が 不一致を 検出する。
"""
import json
import os
import sys
import datetime

from public_quotes import load_excerpts, public_quote_fields, with_page, within_limit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(ROOT, "frontend", "data", "drug_list.json")
GV = os.path.join(ROOT, "frontend", "data", "guideline_variations.json")
OUT = os.path.join(ROOT, "frontend", "data", "washout_public_v1.json")

# --- 公開して よい variation field (値 + 出典ラベル + 派生サマリ のみ。 短い引用・所在・URL は _public_variations で 付加) ---
# 除外: note / purpose / quote / quote_verbatim / _manual / _note_* / dose_dependent_is_complex 等
VAR_SURGERY_KEEP = ["source", "high_risk_days", "low_risk_days", "value_derivation",
                    "dose_dependent_summary", "version_label", "version_year"]
VAR_CONTRAST_KEEP = ["source", "days", "value_derivation", "dose_dependent_summary",
                     "version_label", "version_year"]
# 参照の citation field (quote / quote_translation は そのまま 出さず、 _public_reference で 短い引用に 置換)
REF_KEEP = ["source", "title", "url", "verification_status", "year"]


def _pick(d, keys):
    return {k: d[k] for k in keys if d.get(k) is not None}


# --- アプリの daysBadge.js と 同じ 「表示推奨値」 を 算出 ---
# 優先: 現行 series の GL 最大値 > PMDA 最大値 > drug_list master (安全側=長い方)
def _is_pmda(v):
    return "PMDA" in (v.get("source") or "")


def _filter_current_series(vs):
    latest = {}
    for v in vs:
        sid, yr = v.get("series_id"), v.get("version_year")
        if sid and isinstance(yr, (int, float)):
            latest[sid] = max(latest.get(sid, yr), yr)
    out = []
    for v in vs:
        sid = v.get("series_id")
        if sid and sid in latest:
            if v.get("version_year") == latest[sid]:
                out.append(v)
        else:
            out.append(v)
    return out


def _nums(vs, key):
    return [v[key] for v in vs if isinstance(v.get(key), (int, float))]


def effective_days(variations, master, key):
    """daysBadge 相当: 現行GL最大 > PMDA最大 > master。 全て無ければ None。"""
    variations = variations or []
    gl = _nums(_filter_current_series([v for v in variations if not _is_pmda(v)]), key)
    if gl:
        return max(gl)
    pm = _nums([v for v in variations if _is_pmda(v)], key)
    if pm:
        return max(pm)
    return master


def _public_variations(gv_entry, keep, entries, warnings):
    out = []
    for v in (gv_entry or []):
        rec = _pick(v, keep)
        if rec.get("source"):
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
    """drug_list + guideline_variations から 公開 DB の dict を組み立てる (書き出しは しない)。
    warnings (dict) を 渡すと 未承認で 引用を 出さなかった 件数 等を 記録する。"""
    if warnings is None:
        warnings = {}
    dl = json.load(open(DL, encoding="utf-8"))
    gv = json.load(open(GV, encoding="utf-8"))
    gv_drugs = gv.get("drugs", {})
    entries = load_excerpts().get("entries", {})

    drugs_out = []
    for d in dl["drugs"]:
        name = d.get("name")
        surg = d.get("surgery") or {}
        cont = d.get("contrast_ct") or {}
        gentry = gv_drugs.get(name, {})

        rec = {
            "name": name,
            "category": d.get("category"),
            "aliases": d.get("aliases") or [],
            "brand_names": d.get("brand_names") or [],
            "generic_brands": d.get("generic_brands") or [],
            # 周術期 休薬 (drug_list の note は 作者による 解説 = 公開可)
            "surgery": {
                "required": surg.get("required"),
                # master (drug_list の primary 採用値)
                "high_risk_days_before": surg.get("high_risk_days_before"),
                "low_risk_days_before": surg.get("low_risk_days_before"),
                # 表示推奨値 (アプリのバッジ相当: 現行GL最大 = 安全側)。 consumer は これを 使うと 安全
                "display_high_risk_days_before": effective_days(
                    (gentry.get("surgery")), surg.get("high_risk_days_before"), "high_risk_days"),
                "display_low_risk_days_before": effective_days(
                    (gentry.get("surgery")), surg.get("low_risk_days_before"), "low_risk_days"),
                "high_risk_surgery_examples": surg.get("high_risk_surgery_examples") or [],
                "low_risk_surgery_examples": surg.get("low_risk_surgery_examples") or [],
                "note": surg.get("note"),
            },
            "contrast_ct": {
                "required": cont.get("required"),
                "days_before": cont.get("days_before"),
                "display_days_before": effective_days(
                    (gentry.get("contrast_ct")), cont.get("days_before"), "days"),
                "note": cont.get("note"),
            },
            # ガイドライン別 washout (値 + 出典ラベル + 短い引用 + 所在。 全文 quote / note は 含めない)
            "guideline_variations": {
                "surgery": _public_variations(gentry.get("surgery"), VAR_SURGERY_KEEP, entries, warnings),
                "contrast_ct": _public_variations(gentry.get("contrast_ct"), VAR_CONTRAST_KEEP, entries, warnings),
            },
            # 出典 (source/title/url/検証status + 短い引用 + 所在。 全文 quote は 無し)
            "references": [_public_reference(r, entries, warnings) for r in (d.get("references") or [])],
        }
        drugs_out.append(rec)

    out = {
        "_meta": {
            "name": "休薬情報データベース (Kyuyaku Data)",
            "author": "梅谷 直亨 (Naoyuki Umetani)",
            "api_version": "1.0",
            "data_version": dl.get("version"),
            "data_updated_at": dl.get("updated_at"),
            "generated_at": datetime.date.today().isoformat(),
            "scope": "周術期・造影CT の 休薬情報のみ",
            "drug_count": len(drugs_out),
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "license_exceptions": "quote_excerpt / quote_translation_excerpt は CC BY 4.0 の 対象外です。 各出典 (学会ガイドライン / PMDA 添付文書 等) の 著作物を 著作権法 32 条に 基づき 引用したもので、 著作権は 各権利者に 帰属します。 再利用する 場合は 出典を 明示し、 各権利者の 条件に 従ってください。",
            "attribution": "梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data",
            "disclaimer": "本データは 意思決定支援のための 参考情報です。 最終的な 休薬判断は 医療者の 責任で 行ってください。 内容は 無保証で、 継続的に 更新されます。",
            "verbatim_quotes": "quote_excerpt は 一次資料 (学会GL / PMDA添付文書 等) からの 引用または抜粋です (一部、 参考資料・作者による注記を 含みます。 極端に長いものは 抜粋、 ' … ' は 中略)。 正確な 記載は location_in_source / source_location と url / source_url (PDF は 該当頁に 移動) で 原典を 確認してください。",
            "value_semantics": "high_risk_days_before 等は 作者の 採用値 (primary)。 display_* は 現行GLの最長値 (安全側) — 消費側は display_* の使用を推奨。 各GLの個別値は guideline_variations 参照。",
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
    """比較用: 実行日で 毎回 変わる _meta.generated_at を 除いた コピー。"""
    db = dict(db)
    db["_meta"] = {k: v for k, v in (db.get("_meta") or {}).items() if k != "generated_at"}
    return db


def check(out):
    """--check: commit 済み OUT が 現在の 入力から 再生成した 内容と 一致するか (generated_at は 除外)。"""
    if not os.path.exists(OUT):
        print(f"✗ {os.path.relpath(OUT, ROOT)} が 無い", file=sys.stderr)
        return 1
    cur = json.load(open(OUT, encoding="utf-8"))
    if _without_generated_at(cur) == _without_generated_at(out):
        print(f"✓ 公開 DB は 最新 ({os.path.relpath(OUT, ROOT)}, {len(out['drugs'])} 剤)")
        return 0
    old_by = {d.get("name"): d for d in cur.get("drugs", [])}
    new_by = {d.get("name"): d for d in out["drugs"]}
    diff = sorted(n for n in set(old_by) | set(new_by) if old_by.get(n) != new_by.get(n))
    print(f"✗ 公開 DB が 入力 (drug_list / guideline_variations) と 不一致: {len(diff)} 剤", file=sys.stderr)
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
    except ValueError as ex:  # 台帳の 抜粋が 原文と 不一致 等
        print(f"✗ {ex}", file=sys.stderr)
        return 1

    # 安全確認: 公開データに verbatim/内部 field が 混入していないか (混入時は 書き出さずに 異常終了)
    blob = json.dumps(out, ensure_ascii=False)
    leaked = [k for k in ("quote", "quote_verbatim", "quote_translation", "_manual",
                          "_note_original", "_note_reextracted", "_pmda_class")
              if f'"{k}"' in blob]
    if leaked:
        print(f"✗ 除去すべき field が 残存: {leaked}", file=sys.stderr)
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
    print("  ✓ verbatim quote / 内部 field の 混入なし、 quote_excerpt は 全件 上限内")
    if warnings.get("unapproved"):
        print(f"  ⓘ 上限超過で 抜粋 未承認のため 引用を 省略: {warnings['unapproved']} 件"
              " (python tools/prepare_quote_excerpts.py --report で 確認)")
    if warnings.get("translation_over"):
        print(f"  ⓘ 和訳が 和文上限を 超えるため 和訳を 省略: {warnings['translation_over']} 件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
