<?php
/**
 * ファイルベース sliding window レート制限。
 *
 * 用途: 未認証ユーザー向けエンドポイント (/analyze-text.php 等) の bot 乱用対策。
 * 認証済ユーザーには適用しない (呼び出し側で分岐)。
 *
 * 方式:
 *   - 1 バケットにつき 1 ファイル (<dir>/<bucket>.txt) に UNIX epoch 秒を 1 行 1 件で保存。
 *   - 呼ばれるたび cutoff = now - $windowSec より古い項目を捨て、残件数で判定。
 *   - flock(LOCK_EX) で排他、失敗時は fail-open (ディスクフル等で正規ユーザーを巻き込まない)。
 *
 * 確率的 GC: 1% の確率で dir 内の 10 分以上 mtime が古いファイルを unlink (cron 不要)。
 *
 * PHP 7.4 互換 (str_starts_with / str_contains / match は使わない)。
 */

class RateLimiter
{
    /**
     * 同一バケットからのリクエストが直近 $windowSec 秒で $limit 回を超えていなければ
     * 新しいタイムスタンプを記録して true を返す。超えていれば記録せず false を返す。
     *
     * @param string $bucket   バケット識別子 (例: 'paste_' . sha1($ip))
     * @param int    $limit    ウィンドウ内の許容リクエスト数
     * @param int    $windowSec ウィンドウ秒数
     * @return bool true = 通過可、false = 上限超過 (429 を返すべき)
     */
    public static function checkAndRecord(string $bucket, int $limit, int $windowSec): bool
    {
        $dir = self::dir();
        if (!self::ensureDir($dir)) {
            // dir 作成失敗 → fail-open
            return true;
        }

        $safe = preg_replace('/[^A-Za-z0-9_-]/', '', $bucket);
        if ($safe === '' || $safe === null) {
            $safe = 'unknown';
        }
        $path = $dir . '/' . $safe . '.txt';

        $fp = @fopen($path, 'c+');
        if ($fp === false) {
            error_log('[RateLimiter] fopen failed: ' . $path);
            return true; // fail-open
        }

        $ok = true;
        try {
            if (!@flock($fp, LOCK_EX)) {
                return true; // fail-open
            }

            $now = time();
            $cutoff = $now - $windowSec;

            $raw = '';
            while (!feof($fp)) {
                $chunk = fread($fp, 8192);
                if ($chunk === false) break;
                $raw .= $chunk;
            }

            $stamps = [];
            if ($raw !== '') {
                foreach (explode("\n", $raw) as $line) {
                    $line = trim($line);
                    if ($line === '') continue;
                    if (!ctype_digit($line)) continue;
                    $t = (int)$line;
                    if ($t >= $cutoff) $stamps[] = $t;
                }
            }

            if (count($stamps) >= $limit) {
                // 上限超過: 記録せず false 。(古い項目を捨てた状態で書き戻しは行う = clean up)
                self::writeBack($fp, $stamps);
                $ok = false;
            } else {
                $stamps[] = $now;
                self::writeBack($fp, $stamps);
                $ok = true;
            }

            @flock($fp, LOCK_UN);
        } finally {
            @fclose($fp);
        }

        // 確率的 GC (1%)
        if (mt_rand(0, 99) === 0) {
            self::gc($dir, 600);
        }

        return $ok;
    }

    /** タイムスタンプ配列をファイルに書き戻す (ファイルポインタは fopen('c+') 直後の想定) */
    private static function writeBack($fp, array $stamps): void
    {
        @rewind($fp);
        @ftruncate($fp, 0);
        if (count($stamps) > 0) {
            @fwrite($fp, implode("\n", $stamps) . "\n");
        }
    }

    /** $maxAgeSec より mtime が古いカウンタファイルを削除する (確率的に呼ばれる) */
    private static function gc(string $dir, int $maxAgeSec): void
    {
        $cutoff = time() - $maxAgeSec;
        $files = @glob($dir . '/*.txt');
        if (!is_array($files)) return;
        foreach ($files as $f) {
            $mt = @filemtime($f);
            if ($mt !== false && $mt < $cutoff) {
                @unlink($f);
            }
        }
    }

    /** 書き込み用 dir を保証する (無ければ作る) */
    private static function ensureDir(string $dir): bool
    {
        if (is_dir($dir)) return true;
        if (@mkdir($dir, 0775, true)) return true;
        return is_dir($dir); // 競合で他プロセスが作った場合
    }

    /** カウンタ保存先 (_config.php の KYUYAKU_RATELIMIT_DIR で解決) */
    private static function dir(): string
    {
        if (defined('KYUYAKU_RATELIMIT_DIR')) {
            return KYUYAKU_RATELIMIT_DIR;
        }
        // フォールバック (_config.php が読み込まれていない異常系)
        return __DIR__ . '/../data/_ratelimit';
    }
}
