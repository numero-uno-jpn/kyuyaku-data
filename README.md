# 休薬情報データベース (Kyuyaku Data)

周術期・造影 CT 検査前の **休薬情報** を、学会ガイドライン・PMDA 添付文書などの一次資料に基づいて整理したオープンデータです。

- **検索サイト: https://numero-uno-jpn.github.io/kyuyaku-data/** (一般名・商品名で 検索、 薬効分類で 絞り込み)
- 作者: 梅谷 直亨 (Naoyuki Umetani, 医師)
- データ: [`data/washout_public_v1.json`](data/washout_public_v1.json) (継続更新)
- ライセンス: データ [CC BY 4.0](LICENSE-DATA) / コード [MIT](LICENSE)
- API: `https://numero-uno-jpn.github.io/kyuyaku-data/v1/` (静的 JSON、 read-only、 無料、 [仕様](docs/api.md))

> ⚠ 本データは 意思決定支援のための 参考情報です。 最終的な休薬判断は 医療者の責任で 行ってください。 無保証です。 詳しくは [DISCLAIMER.md](DISCLAIMER.md)。

## 収録内容

各薬剤について、次の情報を収録しています。

| 項目 | 内容 |
|---|---|
| 周術期の休薬日数 | 出血リスク高 / 低の手術ごと。 `display_*` は 現行ガイドラインの最長値 (安全側) |
| 造影 CT 前の休薬 | 必要性と日数 |
| ガイドライン別の値 | 各ガイドラインの個別値と、 値の出どころ (`value_derivation`: 直接記載 / クラス推奨の当てはめ / 計算値) |
| 出典 | 出典名・URL (PDF は該当頁へのリンク)・所在 (頁・表) と、 一次資料からの 引用または抜粋 |

フィールドの意味は [docs/api.md](docs/api.md) を参照してください。

## 使い方

```bash
# 全件データ
curl -O https://raw.githubusercontent.com/numero-uno-jpn/kyuyaku-data/main/data/washout_public_v1.json

# API で 1 薬剤 (一般名)
curl https://numero-uno-jpn.github.io/kyuyaku-data/v1/drugs/アピキサバン.json

# 商品名・別名 → 一般名 の 索引
curl https://numero-uno-jpn.github.io/kyuyaku-data/v1/lookup.json
```

## 帰属表示

データを利用する際は、次のように表示してください。

```
梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data
```

論文等で引用する場合は [CITATION.cff](CITATION.cff) の情報 (版番号を含む) を使ってください。

**引用部分の扱い:** `quote_excerpt` / `quote_translation_excerpt` は 各出典の著作物からの 引用または抜粋 (一部、 参考資料・作者による注記を含む) であり、 CC BY 4.0 の対象外です。 正確な記載は 所在と URL から 原典で確認してください。

## 誤りの報告

内容の誤りに気づいた場合は、 [Issue](../../issues/new?template=correction.md) から 根拠 (一次資料の URL・頁) を添えて お知らせください。

## このリポジトリについて

本リポジトリの内容は 作者が管理する 正本データから 自動生成・同期されています。 直接の Pull Request は 受け付けていません (誤りの報告は Issue へ)。
`code/` には 公開データを 生成するロジックと API の 参照実装を 透明性のために 掲載しています (正本データ自体は 含みません)。
