# 公開 API — 休薬情報データベース (Kyuyaku Data) v1

学会ガイドライン・PMDA添付文書に基づく **周術期・造影CT の休薬情報** を、誰でも無料で使える read-only の静的 JSON API として提供します。

- **ベースURL**: `https://numero-uno-jpn.github.io/kyuyaku-data/v1/` (GitHub Pages)
- **ライセンス**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（帰属表示すれば自由に利用可）
  - **例外**: `quote_excerpt` / `quote_translation_excerpt` は CC BY 4.0 の **対象外** です。各出典 (学会ガイドライン / PMDA 添付文書等) の著作物を著作権法 32 条に基づき引用したもので、著作権は各権利者に帰属します。再利用する場合は出典を明示し、各権利者の条件に従ってください (`meta.json` の `license_exceptions` にも記載)
- **帰属表示**: `梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data`
- **CORS**: 全開放 (`Access-Control-Allow-Origin: *`)
- **スコープ**: 休薬情報のみ (周術期 washout + 造影CT)。相互作用等は対象外
- **引用または抜粋**: `quote_excerpt` は一次資料からの引用または抜粋です (一部、参考資料・作者による注記を含みます。和文 300 字 / 英文 600 字を超えるものは抜粋、` … ` は中略)。正確な記載は所在 (`location_in_source` / `source_location`) と URL (PDF は `#page=N` で該当頁へ移動) から原典で確認してください (著作権配慮)

> ⚠ 本データは意思決定支援のための参考情報です。最終的な休薬判断は医療者の責任で行ってください。無保証・継続更新。

## エンドポイント

| メソッド | パス | 内容 |
|---|---|---|
| GET | `v1/meta.json` | データ版・ライセンス・免責・件数・エンドポイント一覧 |
| GET | `v1/drugs.json` | 全薬剤の一覧 (name / category / 別名 / 商品名 / washout サマリ / 詳細ファイルのパス `file`) |
| GET | `v1/drugs/{一般名}.json` | 1 薬剤の休薬詳細 (`{"drug": …}`) |
| GET | `v1/lookup.json` | 一般名・別名・商品名・後発品名 (小文字) → 一般名の配列 |
| GET | **`https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?q=…`** | **検索 API** (一致した薬を一致度順の配列で。下記) |
| GET | `v1/search-index.json` | あいまい検索用の索引 (`assets/search.js` と組み合わせる。下記) |

**別名・商品名で引くとき**は、`lookup.json` で一般名を得てから `drugs/{一般名}.json` を取得します。1 つの商品名が複数の一般名に対応する場合 (配合剤等) は配列に複数入ります。
ファイル名に使えない文字 (`/` 等) を含む一般名は全角に置き換えています。`drugs.json` の `file` を使うと確実です。

## 検索 API (`?q=`)

**`GET https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?q={薬の名前}&limit={1-100}`** ([仕様ページ](https://numero-uno-jpn.github.io/kyuyaku-data/search-api.html)、その場で試せる欄付き)

一般名・別名・商品名・後発品名・薬効分類名で検索し、一致した薬を **一致度の高い順の配列** で返します。打ち間違い・表記ゆれも吸収します (参照アプリと同じ検索です)。認証不要・CORS 全開放。

```bash
curl "https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?q=%E3%82%A8%E3%83%B3%E3%83%AC%E3%82%B9%E3%83%88"   # q=エンレスト
```

```json
{
  "query": "エンレスト",
  "count": 2,
  "results": [
    {
      "name": "バルサルタン", "category": "ARB (降圧薬)",
      "score": 90, "kind": "prefix", "matched": "エンレスト錠50mg",
      "surgery_high_risk_days_before": 1, "surgery_low_risk_days_before": 0,
      "surgery_high_risk_day_of": false, "surgery_low_risk_day_of": false,
      "contrast_required": false, "contrast_days_before": null, "contrast_day_of": false,
      "detail": "https://numero-uno-jpn.github.io/kyuyaku-data/v1/drugs/バルサルタン.json",
      "page": "https://numero-uno-jpn.github.io/kyuyaku-data/#/drugs/バルサルタン"
    },
    { "name": "サクビトリル・バルサルタン", "...": "..." }
  ],
  "suggestions": [],
  "_notice": { "license": "CC BY 4.0", "attribution": "…", "disclaimer": "…" }
}
```

| 項目 | 意味 |
|---|---|
| `q` (必須) | 検索語 (100 文字以内)。URL エンコードして渡す |
| `limit` | 返す最大件数 (1〜100、既定 20) |
| `results[]` | 一致した薬 (一致度順)。`score` / `kind` は下の「あいまい検索」と同じ。`matched` は一致した名前。休薬日数は安全側の値 (`display_*` と同じ) |
| `results[].detail` | その薬の詳細 JSON の URL |
| `results[].page` | 参照アプリのその薬のページ |
| `suggestions[]` | 0 件の時のみ。「もしかして」の候補 (`name` / `term` / `distance`) |

- エラー: `q` なし・長すぎ → 400、GET 以外 → 405、データ取得の一時的な失敗 → 503。応答は 5 分キャッシュされます。データは参照アプリと同じものを最大 10 分の遅れで反映します。
- **Python の標準ライブラリ `urllib` で呼ぶ場合は `User-Agent` を指定してください** (既定の `Python-urllib/…` は配信基盤 (Cloudflare) の仕組みで拒否されます。`requests`・curl・ブラウザ等はそのままで使えます)。

```python
import json, urllib.parse, urllib.request
url = 'https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?' + urllib.parse.urlencode({'q': 'アスピリン'})
req = urllib.request.Request(url, headers={'User-Agent': 'my-app/1.0'})
print(json.load(urllib.request.urlopen(req))['results'][0]['name'])   # アスピリン
```

## あいまい検索 (ブラウザ・プログラム内で使う)

上の検索 API と同じ **あいまい検索の関数** (`assets/search.js`、外部ライブラリなし・CC BY 4.0) とその **索引** (`v1/search-index.json`) も公開しています。ネットワーク越しに呼ばず、ブラウザや自分のプログラムの中で検索したい場合に使えます。

```js
import { buildIndex, search, suggest } from 'https://numero-uno-jpn.github.io/kyuyaku-data/assets/search.js';

const BASE = 'https://numero-uno-jpn.github.io/kyuyaku-data/v1';
const index = buildIndex((await (await fetch(`${BASE}/search-index.json`)).json()).drugs);

search(index, 'アスピリソ');
// → [{ name: 'アスピリン', score: 63, term: 'アスピリン', kind: 'typo' }]
search(index, 'ばいあすぴりん');
// → [{ name: 'アスピリン', score: 90, term: 'バイアスピリン錠100mg', kind: 'prefix' }]
suggest(index, 'ワルハリソ');    // 何も当たらない時の「もしかして」候補
// → [{ name: 'ワルファリン', term: 'ワルファリン', distance: 3 }, …]
```

- 対象: 一般名・別名・商品名・後発品名 (+ 薬効分類名)
- 吸収する違い: 全角/半角、ひらがな/カタカナ、小書き文字 (ュ/ユ)、大文字/小文字、長音 (ー) の有無、濁点・半濁点、ヴ/ブ、打ち間違い (4 文字以上で 1 文字、8 文字以上で 2 文字まで)
- 一致の種類 (`kind`) と得点 (`score`): `exact` 100 / `prefix` 90 / `partial` 80 / `variant` (表記ゆれ) 70 / `category` (薬効分類) 66 / `typo` (打ち間違い) 40〜65。得点の高い順に並びます
- 結果の `name` (一般名) で `drugs/{一般名}.json` を取得します (`search-index.json` の `file` も使えます)

**参照アプリの URL 検索**: `https://numero-uno-jpn.github.io/kyuyaku-data/?q=アスピリン` のように開くと、検索済みの状態で表示されます。他のサイトや院内資料からのリンクに使えます。

## 値のセマンティクス (重要)

| フィールド | 意味 |
|---|---|
| `surgery.high_risk_days_before` / `low_risk_days_before` | 作者の採用値 (primary) |
| `surgery.high_risk_day_of` / `low_risk_day_of` / `contrast_ct.day_of` | `true` は作者の採用値が **手術当日の休薬** (日数の欄は `null`) |
| `surgery.display_high_risk_days_before` / `display_low_risk_days_before` | **表示推奨値** = 現行ガイドラインの最長値 (安全側)。**消費側はこちらの使用を推奨** |
| `contrast_ct.days_before` / `display_days_before` | 同上 (造影CT) |
| `surgery.display_high_risk_day_of` / `display_low_risk_day_of` / `contrast_ct.display_day_of` | `true` は表示推奨値が **手術当日の休薬** (前日まで服用可) であること。このとき日数の欄は `null` |
| 日数の値 | `0` = 休薬不要、`null` = 記載なし。`1` は 1 日休薬 (前日から休薬) で、手術当日だけの休薬は日数ではなく `*_day_of: true` で表す。**日数が `null` でも対応する `*_day_of` が `true` なら「記載なし」ではなく当日休薬** (`api_version` 1.1 から。1.0 では当日休薬の薬に 1 などの日数が入っていたため、印を読まない利用側は「記載なし」と誤読しないよう対応が必要) |
| `guideline_variations.surgery[]` / `contrast_ct[]` | ガイドライン別の個別値 + 出典ラベル (+ eGFR/用量別の `dose_dependent_summary`)。`source_location` (所在) / `source_url` / `quote_excerpt` (引用または抜粋) を含む場合あり |
| `guideline_variations.*[].high_risk_hours` / `low_risk_hours` / `hours` | 原文が時間で書かれた値 (日数の欄は `null`)。表示推奨値の計算では日数に切り上げる (12 時間 → 1 日、48 時間 → 2 日。手術時刻が当日動くため前日から休薬する扱い) |
| `guideline_variations.*[].high_risk_day_of` / `low_risk_day_of` / `day_of` | `true` は原文が「手術当日の休薬」 (日数の欄は `null`) |
| `guideline_variations.*[].value_derivation` | **値の出どころ** (重要)。`direct` = ガイドラインがその薬剤の値を直接記載 / `class` = ガイドラインは薬効クラス (SGLT2 阻害薬等) 単位で推奨しており、その値を個別薬に当てはめた / `derived` = ガイドラインの半減期 × N 倍ルール等から作者が計算した値。未設定は未分類 (PMDA 添付文書等の手入力値。添付文書やガイドラインが日数を書かずに手術前後の休薬・禁忌を求める場合、その行は 1 日として記録する)。**`direct` 以外はガイドラインにその日数が明記されているわけではない** |
| `references[]` | 出典 (source / title / url / verification_status) + `location_in_source` (所在)。`quote_excerpt` (引用または抜粋) / `quote_translation_excerpt` (英文引用の和訳) を含む場合あり |
| `quote_excerpt` | 一次資料からの引用または抜粋 (一部、参考資料・作者による注記を含む)。和文 300 / 英文 600 字を超えるものは抜粋 (最大 2 断片を ` … ` で連結)、抜粋が未確定のものは省略 (所在 + URL のみ) |
| `url` / `source_url` の `#page=N` | PDF の該当頁 (PDF のページ番号。印刷ページ番号とは異なることがある) |

`display_*` は「現行版のガイドラインの最大値 > PMDA 添付文書の最大値 > 作者の採用値」の順で決めた安全側の値です。比べるときは時間を日数に切り上げ、当日休薬は 0 日 (休薬不要) より長く 1 日より短いものとして扱います。この順は優先順で、現行版のガイドラインに値があれば、添付文書や作者の採用値の方が長くてもガイドラインの値を使います。採用値は表示推奨値より短いことも長いこともあるため、利用側は `display_*` を使ってください。

### 版の変更履歴

| api_version | 内容 |
|---|---|
| 1.1 (2026-10) | 当日休薬の印 (`*_day_of` / `day_of`、`display_*_day_of`、検索 API の `surgery_*_day_of` / `contrast_day_of`) と、ガイドライン別の時間の値 (`*_hours`) を追加。当日休薬の薬は日数が `null` になった |
| 1.0 | 初版 |

## 例

```bash
BASE=https://numero-uno-jpn.github.io/kyuyaku-data/v1

# メタ情報
curl $BASE/meta.json

# 一覧
curl $BASE/drugs.json

# 詳細 (一般名)
curl $BASE/drugs/アピキサバン.json

# 商品名から引く: lookup で一般名を得て詳細を取得
curl -s $BASE/lookup.json | jq -r '.lookup["エリキュース錠5mg"][]'   # → アピキサバン
```

レスポンスは全て `_notice` (license / license_exceptions / attribution / disclaimer) を含みます。

## 全件データ

全件データ (`washout_public_v1.json`) は GitHub の [numero-uno-jpn/kyuyaku-data](https://github.com/numero-uno-jpn/kyuyaku-data) の `data/` から取得できます (版管理あり)。
