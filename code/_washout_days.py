#!/usr/bin/env python3
"""
休薬期間の「比較・表示用の日数」を Python から使う窓口。

規則そのものは frontend/js/utils/daysBadge.js だけにある (アプリと公開データで日数がずれないよう、
Python 側に同じ規則を持たない)。ここは tools/washout_days.cjs を Node.js で呼んで結果を返すだけ。
規則の表は tests/unit/fixtures/washout_days_cases.json (daysBadge.test.js が確かめる)。

  effective_days(days, hours, day_of) → 比較用の日数 (当日休薬は 0.5、記載なしは None)
  format_value(days, hours, day_of)   → 表示 (例 '継続可' / '7日' / '当日休薬' / '2日 (48時間)'、記載なしは None)
  prefetch(values)                    → [(days, hours, day_of), ...] をまとめて計算しておく (Node の起動を 1 回で済ませる)
  display_days(drugs)                 → {一般名: {'high': [日数, 当日休薬か], 'low': [...], 'contrast': [...]}}
                                         (アプリのバッジと同じ値。当日休薬が最長なら [None, True])
"""
from __future__ import annotations
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
RUNNER = os.path.join(ROOT, "tools", "washout_days.cjs")

_cache: dict = {}


def _run(req):
    res = subprocess.run(["node", RUNNER], input=json.dumps(req, ensure_ascii=False),
                         capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise RuntimeError(f"tools/washout_days.cjs が失敗しました: {res.stderr.strip()}")
    return json.loads(res.stdout)


def _key(days, hours, day_of):
    return (days, hours, bool(day_of))


def prefetch(values):
    todo = list(dict.fromkeys(_key(*v) for v in values if _key(*v) not in _cache))
    if not todo:
        return
    for k, r in zip(todo, _run({"values": [list(k) for k in todo]})["values"]):
        _cache[k] = (r["eff"], r["text"])


def _get(days, hours, day_of):
    k = _key(days, hours, day_of)
    if k not in _cache:
        prefetch([k])
    return _cache[k]


def effective_days(days=None, hours=None, day_of=False):
    return _get(days, hours, day_of)[0]


def format_value(days=None, hours=None, day_of=False):
    return _get(days, hours, day_of)[1]


def display_days(drugs):
    return _run({"drugs": drugs})["drugs"]
