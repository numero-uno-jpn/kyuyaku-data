# 公開 API — 休薬情報データベース (Kyuyaku Data) v1

学会ガイドライン・PMDA添付文書に基づく **周術期・造影CT の休薬情報** を、 誰でも無料で 使える read-only の 静的 JSON API として 提供します。

- **ベースURL**: `https://numero-uno-jpn.github.io/kyuyaku-data/v1/` (GitHub Pages)
- **ライセンス**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（帰属表示すれば 自由に利用可）
  - **例外**: `quote_excerpt` / `quote_translation_excerpt` は CC BY 4.0 の **対象外** です。 各出典 (学会ガイドライン / PMDA 添付文書 等) の 著作物を 著作権法 32 条に 基づき 引用したもので、 著作権は 各権利者に 帰属します。 再利用する 場合は 出典を 明示し、 各権利者の 条件に 従ってください (`meta.json` の `license_exceptions` にも 記載)
- **帰属表示**: `梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data`
- **CORS**: 全開放 (`Access-Control-Allow-Origin: *`)
- **スコープ**: 休薬情報のみ (周術期 washout + 造影CT)。 相互作用等は 対象外
- **引用または抜粋**: `quote_excerpt` は 一次資料からの 引用または抜粋です (一部、 参考資料・作者による注記を 含みます。 和文 300 字 / 英文 600 字を 超えるものは 抜粋、 ` … ` は 中略)。 正確な 記載は 所在 (`location_in_source` / `source_location`) と URL (PDF は `#page=N` で 該当頁へ 移動) から 原典で 確認してください (著作権配慮)

> ⚠ 本データは 意思決定支援のための 参考情報です。 最終的な休薬判断は 医療者の責任で 行ってください。 無保証・継続更新。

## エンドポイント

| メソッド | パス | 内容 |
|---|---|---|
| GET | `v1/meta.json` | データ版・ライセンス・免責・件数・エンドポイント一覧 |
| GET | `v1/drugs.json` | 全薬剤の 一覧 (name / category / 別名 / 商品名 / washout サマリ / 詳細ファイルの パス `file`) |
| GET | `v1/drugs/{一般名}.json` | 1 薬剤の 休薬詳細 (`{"drug": …}`) |
| GET | `v1/lookup.json` | 一般名・別名・商品名・後発品名 (小文字) → 一般名の 配列 |
| GET | **`https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?q=…`** | **検索 API** (一致した薬を 一致度順の 配列で。 下記) |
| GET | `v1/search-index.json` | あいまい検索用の 索引 (`assets/search.js` と 組み合わせる。 下記) |

**別名・商品名で 引くとき**は、 `lookup.json` で 一般名を 得てから `drugs/{一般名}.json` を 取得します。 1 つの 商品名が 複数の 一般名に 対応する場合 (配合剤 等) は 配列に 複数 入ります。
ファイル名に 使えない 文字 (`/` 等) を 含む 一般名は 全角に 置き換えています。 `drugs.json` の `file` を 使うと 確実です。

## 検索 API (`?q=`)

**`GET https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?q={薬の名前}&limit={1-100}`**

一般名・別名・商品名・後発品名・薬効分類名で 検索し、 一致した薬を **一致度の 高い順の 配列** で 返します。 打ち間違い・表記ゆれも 吸収します (参照アプリと 同じ 検索です)。 認証不要・CORS 全開放。

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
      "contrast_required": false, "contrast_days_before": null,
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
| `q` (必須) | 検索語 (100 文字以内)。 URL エンコードして 渡す |
| `limit` | 返す 最大件数 (1〜100、 既定 20) |
| `results[]` | 一致した薬 (一致度順)。 `score` / `kind` は 下の「あいまい検索」 と 同じ。 `matched` は 一致した 名前。 休薬日数は 安全側の値 (`display_*` と 同じ) |
| `results[].detail` | その薬の 詳細 JSON の URL |
| `results[].page` | 参照アプリの その薬の ページ |
| `suggestions[]` | 0 件の 時のみ。 「もしかして」 の 候補 (`name` / `term` / `distance`) |

- エラー: `q` なし・長すぎ → 400、 GET 以外 → 405、 データ取得の 一時的な 失敗 → 503。 応答は 5 分 キャッシュされます。 データは 参照アプリと 同じものを 最大 10 分の 遅れで 反映します。
- **Python の 標準ライブラリ `urllib` で 呼ぶ 場合は `User-Agent` を 指定してください** (既定の `Python-urllib/…` は 配信基盤 (Cloudflare) の 仕組みで 拒否されます。 `requests`・curl・ブラウザ等は そのままで 使えます)。

```python
import json, urllib.parse, urllib.request
url = 'https://kyuyaku-data.numero-uno-jpn.workers.dev/v1/search?' + urllib.parse.urlencode({'q': 'アスピリン'})
req = urllib.request.Request(url, headers={'User-Agent': 'my-app/1.0'})
print(json.load(urllib.request.urlopen(req))['results'][0]['name'])   # アスピリン
```

## あいまい検索 (ブラウザ・プログラム内で 使う)

上の 検索 API と 同じ **あいまい検索の 関数** (`assets/search.js`、 外部ライブラリなし・MIT) と その **索引** (`v1/search-index.json`) も 公開しています。 ネットワーク越しに 呼ばず、 ブラウザや 自分の プログラムの 中で 検索したい 場合に 使えます。

```js
import { buildIndex, search, suggest } from 'https://numero-uno-jpn.github.io/kyuyaku-data/assets/search.js';

const BASE = 'https://numero-uno-jpn.github.io/kyuyaku-data/v1';
const index = buildIndex((await (await fetch(`${BASE}/search-index.json`)).json()).drugs);

search(index, 'アスピリソ');
// → [{ name: 'アスピリン', score: 63, term: 'アスピリン', kind: 'typo' }]
search(index, 'ばいあすぴりん');
// → [{ name: 'アスピリン', score: 90, term: 'バイアスピリン錠100mg', kind: 'prefix' }]
suggest(index, 'ワルハリソ');    // 何も 当たらない 時の 「もしかして」 候補
// → [{ name: 'ワルファリン', term: 'ワルファリン', distance: 3 }, …]
```

- 対象: 一般名・別名・商品名・後発品名 (+ 薬効分類名)
- 吸収する 違い: 全角/半角、 ひらがな/カタカナ、 小書き文字 (ュ/ユ)、 大文字/小文字、 長音 (ー) の 有無、 濁点・半濁点、 ヴ/ブ、 打ち間違い (4 文字以上で 1 文字、 8 文字以上で 2 文字まで)
- 一致の 種類 (`kind`) と 得点 (`score`): `exact` 100 / `prefix` 90 / `partial` 80 / `variant` (表記ゆれ) 70 / `category` (薬効分類) 66 / `typo` (打ち間違い) 40〜65。 得点の 高い順に 並びます
- 結果の `name` (一般名) で `drugs/{一般名}.json` を 取得します (`search-index.json` の `file` も 使えます)

**参照アプリの URL 検索**: `https://numero-uno-jpn.github.io/kyuyaku-data/?q=アスピリン` のように 開くと、 検索済みの 状態で 表示されます。 他の サイトや 院内資料からの リンクに 使えます。

## 値のセマンティクス (重要)

| フィールド | 意味 |
|---|---|
| `surgery.high_risk_days_before` / `low_risk_days_before` | 作者の 採用値 (primary) |
| `surgery.display_high_risk_days_before` / `display_low_risk_days_before` | **表示推奨値** = 現行ガイドラインの 最長値 (安全側)。 **消費側は こちらの使用を 推奨** |
| `contrast_ct.days_before` / `display_days_before` | 同上 (造影CT) |
| `guideline_variations.surgery[]` / `contrast_ct[]` | ガイドライン別の 個別値 + 出典ラベル (+ eGFR/用量別の `dose_dependent_summary`)。 `source_location` (所在) / `source_url` / `quote_excerpt` (引用または抜粋) を 含む場合あり |
| `guideline_variations.*[].value_derivation` | **値の出どころ** (重要)。 `direct` = ガイドラインが その薬剤の 値を 直接記載 / `class` = ガイドラインは 薬効クラス (SGLT2 阻害薬 等) 単位で 推奨しており、 その値を 個別薬に 当てはめた / `derived` = ガイドラインの 半減期 × N 倍 ルール等から 作者が 計算した値。 未設定は 未分類 (PMDA 添付文書 等の 手入力値)。 **`direct` 以外は ガイドラインに その日数が 明記されているわけでは ない** |
| `references[]` | 出典 (source / title / url / verification_status) + `location_in_source` (所在)。 `quote_excerpt` (引用または抜粋) / `quote_translation_excerpt` (英文引用の 和訳) を 含む場合あり |
| `quote_excerpt` | 一次資料からの 引用または抜粋 (一部、 参考資料・作者による注記を 含む)。 和文 300 / 英文 600 字を 超えるものは 抜粋 (最大 2 断片を ` … ` で 連結)、 抜粋が 未確定のものは 省略 (所在 + URL のみ) |
| `url` / `source_url` の `#page=N` | PDF の 該当頁 (PDF のページ番号。 印刷ページ番号とは 異なることがある) |

`display_*` は 「現行 版の ガイドラインの 最大値 > PMDA 添付文書の 最大値 > 作者の 採用値」 の 順で 決めた 安全側の 値です。 短い 採用値だけを 表示すると 安全側を 下回るため 注意してください。

## 例

```bash
BASE=https://numero-uno-jpn.github.io/kyuyaku-data/v1

# メタ情報
curl $BASE/meta.json

# 一覧
curl $BASE/drugs.json

# 詳細 (一般名)
curl $BASE/drugs/アピキサバン.json

# 商品名から 引く: lookup で 一般名を 得て 詳細を 取得
curl -s $BASE/lookup.json | jq -r '.lookup["エリキュース錠5mg"][]'   # → アピキサバン
```

レスポンスは全て `_notice` (license / license_exceptions / attribution / disclaimer) を含みます。

## 全件データ

全件データ (`washout_public_v1.json`) は GitHub の [numero-uno-jpn/kyuyaku-data](https://github.com/numero-uno-jpn/kyuyaku-data) の `data/` から 取得できます (版管理あり)。
