<?php
/**
 * public-washout-v1.php 用の 設定例。 _config.php に コピーして 環境に合わせて 変更する。
 */

// washout_public_v1.json の 置き場所 (このリポジトリの data/)
define('KYUYAKU_DATA_DIR', __DIR__ . '/../../data');

// レート制限カウンタの 保存先 (Web から 見えない 書き込み可能な ディレクトリ)
define('KYUYAKU_RATELIMIT_DIR', sys_get_temp_dir() . '/kyuyaku_ratelimit');
