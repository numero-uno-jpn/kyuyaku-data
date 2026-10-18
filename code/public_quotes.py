# -*- coding: utf-8 -*-
"""
公開 DB 用 「短い引用」 の 共通ロジック (build_public_washout_db.py / prepare_quote_excerpts.py が 共用)。

方針 (2026-10-18 確定):
- 引用は 著作権法 32 条の 範囲に 収める: 和文 300 字 / 英文 600 字 以内。
- 上限内の 原文は そのまま 公開。 上限超過は 台帳 (public_quote_excerpts.json) の
  approved 抜粋 のみ 公開。 未承認は 引用なし (所在 + URL のみ)。
- 抜粋は 原文の 連続した 部分文字列 (最大 2 断片を SEP で 連結) に 限る → 機械的に 検証できる。
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
# 英文引用の 中に 当方が 括弧で 添えた 和訳 (かな・漢字を 含む 丸括弧)
_JA_PAREN = re.compile(r"\([^()]*[぀-ヿ一-鿿][^()]*\)")


def is_english(text):
    """一次資料が 英文か: 英字が かな・漢字より 多ければ 英文とみなす。"""
    text = text or ""
    return len(_LATIN.findall(text)) > len(_JA.findall(text))


def limit_for(text):
    """英文は 600、 和文は 300。"""
    return LIMIT_EN if is_english(text) else LIMIT_JA


def counted_len(text):
    """上限判定に 使う 字数。 英文では 括弧で 添えた 和訳を 数えない (訳は 別に 数える)。"""
    text = text or ""
    return len(_JA_PAREN.sub("", text)) if is_english(text) else len(text)


def within_limit(text):
    return counted_len(text) <= limit_for(text)


def translation_ok(text):
    """和訳 field は 引用とは 別に、 和文の 上限で 数える。"""
    return len(text or "") <= LIMIT_JA


def clean_quote(quote):
    """公開用に 原文から 当方の 装飾 (markdown 強調 **) を 除く。 上限判定・抜粋検証も この結果で 行う。"""
    return (quote or "").replace("**", "")


def quote_key(source, quote):
    """台帳の key。 装飾を 含む 正本の quote そのままで 計算する (正本が 変われば 孤立として 検出)。"""
    return hashlib.sha256(f"{source or ''}\n{quote}".encode("utf-8")).hexdigest()


def excerpt_errors(excerpt, quote):
    """抜粋の 検証。 問題が 無ければ 空リスト。"""
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
    """PDF の URL に #page=N を 付ける (既に fragment が あれば そのまま)。"""
    if not url or not page or "#" in url:
        return url
    if ".pdf" not in url.lower():
        return url
    return f"{url}#page={page}"


def public_quote_fields(source, quote, translation, entries, warnings):
    """1 レコード分の 公開 引用 field を返す (dict)。 entries は 台帳の entries。"""
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
    # 和訳は 任意。 引用とは 別に 数え、 和文上限を 超える 訳は 出さない
    if translation:
        if translation_ok(translation):
            out["quote_translation_excerpt"] = translation
        else:
            warnings["translation_over"] = warnings.get("translation_over", 0) + 1
    return out, ent.get("pdf_page")
