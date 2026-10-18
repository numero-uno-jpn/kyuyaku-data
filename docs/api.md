# 公開 API — 休薬情報データベース (Kyuyaku Data) v1

学会ガイドライン・PMDA添付文書に基づく **周術期・造影CT の休薬情報** を、 誰でも無料で 使える read-only API として提供します (MVP)。

- **ベースURL**: `https://api.emuyn.net/kyuyakulens/v1/`
- **ライセンス**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（帰属表示すれば 自由に利用可）
  - **例外**: `quote_excerpt` / `quote_translation_excerpt` は CC BY 4.0 の **対象外** です。 各出典 (学会ガイドライン / PMDA 添付文書 等) の 著作物を 著作権法 32 条に 基づき 引用したもので、 著作権は 各権利者に 帰属します。 再利用する 場合は 出典を 明示し、 各権利者の 条件に 従ってください (`/v1/meta` の `license_exceptions` にも 記載)
- **帰属表示**: `梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data`
- **CORS**: 全開放 (`Access-Control-Allow-Origin: *`)
- **レート制限**: 120 req / 分 / IP (超過時 429 + `Retry-After`)
- **スコープ (MVP)**: 休薬情報のみ (周術期 washout + 造影CT)。 相互作用等は 対象外
- **引用または抜粋**: `quote_excerpt` は 一次資料からの 引用または抜粋です (一部、 参考資料・作者による注記を 含みます。 和文 300 字 / 英文 600 字を 超えるものは 抜粋、 ` … ` は 中略)。 正確な 記載は 所在 (`location_in_source` / `source_location`) と URL (PDF は `#page=N` で 該当頁へ 移動) から 原典で 確認してください (著作権配慮)

> ⚠ 本データは 意思決定支援のための 参考情報です。 最終的な休薬判断は 医療者の責任で 行ってください。 無保証・継続更新。

## エンドポイント

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/v1/meta` | データ版・ライセンス・免責・件数・エンドポイント一覧 |
| GET | `/v1/drugs` | 全薬剤の 一覧 (name / category / 別名 / 商品名 / washout サマリ) |
| GET | `/v1/drugs/{name}` | 1 薬剤の 休薬詳細。`{name}` は 一般名・別名・商品名 の 完全一致で 照合 |

あいまい検索 `/v1/search?q=` は 次フェーズで 提供予定。

## 値のセマンティクス (重要)

| フィールド | 意味 |
|---|---|
| `surgery.high_risk_days_before` / `low_risk_days_before` | 作者の 採用値 (primary) |
| `surgery.display_high_risk_days_before` / `display_low_risk_days_before` | **表示推奨値** = 現行ガイドラインの 最長値 (安全側)。 アプリのバッジと 一致。 **消費側は こちらの使用を 推奨** |
| `contrast_ct.days_before` / `display_days_before` | 同上 (造影CT) |
| `guideline_variations.surgery[]` / `contrast_ct[]` | ガイドライン別の 個別値 + 出典ラベル (+ eGFR/用量別の `dose_dependent_summary`)。 `source_location` (所在) / `source_url` / `quote_excerpt` (短い引用) を 含む場合あり |
| `guideline_variations.*[].value_derivation` | **値の出どころ** (重要)。 `direct` = ガイドラインが その薬剤の 値を 直接記載 / `class` = ガイドラインは 薬効クラス (SGLT2 阻害薬 等) 単位で 推奨しており、 その値を 個別薬に 当てはめた / `derived` = ガイドラインの 半減期 × N 倍 ルール等から 作者が 計算した値。 未設定は 未分類 (PMDA 添付文書 等の 手入力値)。 **`direct` 以外は ガイドラインに その日数が 明記されているわけでは ない** |
| `references[]` | 出典 (source / title / url / verification_status) + `location_in_source` (所在)。 `quote_excerpt` (短い引用) / `quote_translation_excerpt` (英文引用の 和訳) を 含む場合あり |
| `quote_excerpt` | 一次資料からの 引用または抜粋 (一部、 参考資料・作者による注記を 含む)。 和文 300 / 英文 600 字を 超えるものは 抜粋 (最大 2 断片を ` … ` で 連結)、 抜粋が 未確定のものは 省略 (所在 + URL のみ) |
| `url` / `source_url` の `#page=N` | PDF の 該当頁 (PDF のページ番号。 印刷ページ番号とは 異なることがある) |

`display_*` は アプリの `daysBadge.js` と 同一ロジック (現行series GL最大 > PMDA最大 > master)。 短い master 値だけを 表示すると 安全側を 下回るため 注意。

## 例

```bash
# メタ情報
curl https://api.emuyn.net/kyuyakulens/v1/meta

# 一覧
curl https://api.emuyn.net/kyuyakulens/v1/drugs

# 詳細 (一般名)
curl https://api.emuyn.net/kyuyakulens/v1/drugs/アピキサバン
# 商品名でも 照合
curl https://api.emuyn.net/kyuyakulens/v1/drugs/エリキュース錠5mg
```

レスポンスは全て `_notice` (license / attribution / disclaimer) を含みます。

## 全件データ

全件データ (`washout_public_v1.json`) は GitHub の [numero-uno-jpn/kyuyaku-data](https://github.com/numero-uno-jpn/kyuyaku-data) の `data/` から 取得できます (版管理あり)。
API サーバー上の データファイルへの 直接アクセスは 受け付けていません (全件は 上記 GitHub から 取得してください)。
