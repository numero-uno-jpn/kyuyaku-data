# -*- coding: utf-8 -*-
"""
公開 DB 用「短い引用」の共通ロジック (build_public_washout_db.py / prepare_quote_excerpts.py が共用)。

方針 (2026-10-18 確定):
- 引用は著作権法 32 条の範囲に収める: 和文 300 字 / 英文 600 字以内。
- 上限内の原文はそのまま公開。上限超過は台帳 (public_quote_excerpts.json) の
  approved 抜粋のみ公開。未承認は引用なし (所在 + URL のみ)。
- 抜粋は原文の連続した部分文字列 (最大 2 断片を SEP で連結) に限る → 機械的に検証できる。
"""
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCERPTS = os.path.join(ROOT, "frontend", "data", "public_quote_excerpts.json")

LIMIT_JA = 300
LIMIT_EN = 600
SEP = " … "
MAX_FRAGMENTS = 2

_JA = re.compile(r"[぀-ヿ一-鿿]")


_LATIN = re.compile(r"[A-Za-z]")
# 英文引用の中に当方が括弧で添えた和訳 (かな・漢字を含む丸括弧)
_JA_PAREN = re.compile(r"\([^()]*[぀-ヿ一-鿿][^()]*\)")


def is_english(text):
    """一次資料が英文か: 英字がかな・漢字より多ければ英文とみなす。"""
    text = text or ""
    return len(_LATIN.findall(text)) > len(_JA.findall(text))


def limit_for(text):
    """英文は 600、和文は 300。"""
    return LIMIT_EN if is_english(text) else LIMIT_JA


def counted_len(text):
    """上限判定に使う字数。英文では括弧で添えた和訳を数えない (訳は別に数える)。"""
    text = text or ""
    return len(_JA_PAREN.sub("", text)) if is_english(text) else len(text)


def within_limit(text):
    return counted_len(text) <= limit_for(text)


def translation_ok(text):
    """和訳 field は引用とは別に、和文の上限で数える。"""
    return len(text or "") <= LIMIT_JA


def clean_quote(quote):
    """公開用に原文から当方の装飾 (markdown 強調 **) を除く。上限判定・抜粋検証もこの結果で行う。"""
    return (quote or "").replace("**", "")


def quote_key(source, quote):
    """台帳の key。装飾を含む正本の quote そのままで計算する (正本が変われば孤立として検出)。"""
    return hashlib.sha256(f"{source or ''}\n{quote}".encode("utf-8")).hexdigest()


def excerpt_errors(excerpt, quote):
    """抜粋の検証。問題が無ければ空リスト。"""
    errs = []
    frags = excerpt.split(SEP)
    if len(frags) > MAX_FRAGMENTS:
        errs.append(f"断片が {len(frags)} 個 (上限 {MAX_FRAGMENTS})")
    pos = 0
    for f in frags:
        if not f.strip():
            errs.append("空の断片")
            continue
        i = quote.find(f, pos)
        if i < 0:
            errs.append(f"原文の部分文字列でない (または順序違い): {f[:40]}")
        else:
            pos = i + len(f)
    if not within_limit(excerpt):
        errs.append(f"長さ {counted_len(excerpt)} > 上限 {limit_for(excerpt)}")
    return errs


def load_excerpts():
    if not os.path.exists(EXCERPTS):
        return {"_meta": {}, "entries": {}}
    return json.load(open(EXCERPTS, encoding="utf-8"))


def with_page(url, page):
    """PDF の URL に #page=N を付ける (既に fragment があればそのまま)。"""
    if not url or not page or "#" in url:
        return url
    if ".pdf" not in url.lower():
        return url
    return f"{url}#page={page}"


def public_quote_fields(source, quote, translation, entries, warnings):
    """1 レコード分の公開引用 field を返す (dict)。entries は台帳の entries。"""
    if not quote:
        return {}, None
    key = quote_key(source, quote)
    ent = entries.get(key) or {}
    quote = clean_quote(quote)
    out = {}
    if within_limit(quote):
        out["quote_excerpt"] = quote
    elif ent.get("status") == "approved" and ent.get("excerpt"):
        errs = excerpt_errors(ent["excerpt"], quote)
        if errs:
            raise ValueError(f"台帳の抜粋が不正 ({source} / {key[:12]}): {errs}")
        out["quote_excerpt"] = ent["excerpt"]
        translation = ent.get("translation_excerpt")
    else:
        warnings["unapproved"] = warnings.get("unapproved", 0) + 1
        translation = None
    # 和訳は任意。引用とは別に数え、和文上限を超える訳は出さない
    if translation:
        if translation_ok(translation):
            out["quote_translation_excerpt"] = translation
        else:
            warnings["translation_over"] = warnings.get("translation_over", 0) + 1
    return out, ent.get("pdf_page")
