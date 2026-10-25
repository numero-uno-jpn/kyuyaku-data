<?php
/**
 * public-washout-v1.php 用の設定例。_config.php にコピーして環境に合わせて変更する。
 */

// washout_public_v1.json の置き場所 (このリポジトリの data/)
define('KYUYAKU_DATA_DIR', __DIR__ . '/../../data');

// レート制限カウンタの保存先 (Web から見えない書き込み可能なディレクトリ)
define('KYUYAKU_RATELIMIT_DIR', sys_get_temp_dir() . '/kyuyaku_ratelimit');
