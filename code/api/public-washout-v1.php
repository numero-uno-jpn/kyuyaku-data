<?php
/**
 * 公開 API v1 — 休薬情報データベース (Kyuyaku Data, 梅谷 直亨) (read-only, CC BY 4.0)
 *
 * ルーティング (.htaccess で /kyuyakulens/v1/... → 本ファイル?_path=... に rewrite):
 *   GET /v1/meta            … メタ情報 (version / license / disclaimer / 件数)
 *   GET /v1/drugs           … 全薬剤の 一覧 (name / category / washout サマリ)
 *   GET /v1/drugs/{name}    … 1 薬剤の 休薬詳細 (name / alias / 商品名 で lookup)
 *
 * 方針: 休薬情報のみ・一次資料の verbatim 引用は含めない (出典 source/title/url のみ)。
 *       データは build_public_washout_db.py が生成する washout_public_v1.json。
 * PHP 7.4 互換 (さくら)。
 */

require_once __DIR__ . '/_config.php';
require_once __DIR__ . '/lib/RateLimiter.php';

// ---- エラー漏洩防止 (本ハンドラは _bootstrap を include しないため 明示設定) ----
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// ---- 公開 API 用ヘッダ (private API と違い CORS は全開放) ----
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300, must-revalidate');
header('X-License: CC-BY-4.0');

$JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed (GET only)'], $JSON);
    exit;
}

// ---- レート制限: 2 段 (バースト 30/10s + 持続 120/60s) / IP ----
// REMOTE_ADDR を 使用 (さくらは reverse proxy なし → X-Forwarded-For は 信頼しない = spoof 不可)。
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ipKey = preg_replace('/[^a-zA-Z0-9._:]/', '_', $ip);
$burstOk = RateLimiter::checkAndRecord('pubapiB_' . $ipKey, 30, 10);   // 連打 (10秒で30回まで)
$sustOk = RateLimiter::checkAndRecord('pubapi_' . $ipKey, 120, 60);    // 持続 (60秒で120回まで)
if (!$burstOk || !$sustOk) {
    http_response_code(429);
    header('Retry-After: ' . (!$burstOk ? '10' : '60'));
    echo json_encode(['error' => 'Rate limit exceeded (burst 30/10s, sustained 120/60s).'], $JSON);
    exit;
}

// ---- 公開 DB 読み込み ----
$path = KYUYAKU_DATA_DIR . '/washout_public_v1.json';
$raw = @file_get_contents($path);
$db = $raw !== false ? json_decode($raw, true) : null;
if (!is_array($db) || !isset($db['drugs'])) {
    http_response_code(500);
    echo json_encode(['error' => 'data unavailable'], $JSON);
    exit;
}
$meta = isset($db['_meta']) ? $db['_meta'] : [];
$drugs = $db['drugs'];

// ---- ルーティング ----
$p = isset($_GET['_path']) ? $_GET['_path'] : (isset($_SERVER['PATH_INFO']) ? $_SERVER['PATH_INFO'] : '');
$p = trim($p, '/');
$parts = $p === '' ? [] : explode('/', $p);

$notice = [
    'license' => 'CC BY 4.0',
    'license_url' => 'https://creativecommons.org/licenses/by/4.0/',
    'license_exceptions' => isset($meta['license_exceptions']) ? $meta['license_exceptions'] : 'quote_excerpt / quote_translation_excerpt は CC BY 4.0 の対象外 (各出典の著作物の引用)。',
    'attribution' => isset($meta['attribution']) ? $meta['attribution'] : '梅谷 直亨, 休薬情報データベース (Kyuyaku Data), https://github.com/numero-uno-jpn/kyuyaku-data',
    'disclaimer' => isset($meta['disclaimer']) ? $meta['disclaimer'] : '意思決定支援のための参考情報。最終判断は医療者の責任で。無保証。',
];

function normalizeName($s)
{
    return mb_strtolower(trim((string)$s), 'UTF-8');
}

function findDrug($drugs, $query)
{
    $q = normalizeName($query);
    if ($q === '') {
        return null;
    }
    // 1) name 完全一致
    foreach ($drugs as $d) {
        if (normalizeName($d['name']) === $q) {
            return $d;
        }
    }
    // 2) alias / 先発 / 後発 完全一致
    foreach ($drugs as $d) {
        $cands = array_merge(
            isset($d['aliases']) ? $d['aliases'] : [],
            isset($d['brand_names']) ? $d['brand_names'] : [],
            isset($d['generic_brands']) ? $d['generic_brands'] : []
        );
        foreach ($cands as $c) {
            if (normalizeName($c) === $q) {
                return $d;
            }
        }
    }
    return null;
}

function respond($payload, $notice, $flags, $code = 200)
{
    http_response_code($code);
    $payload['_notice'] = $notice;
    echo json_encode($payload, $flags);
    exit;
}

// GET /v1/meta  (または ルート)
if ($parts === [] || $parts[0] === 'meta') {
    respond([
        'meta' => $meta,
        'endpoints' => [
            'GET /v1/meta' => 'このメタ情報',
            'GET /v1/drugs' => '全薬剤の一覧 (name / category / washout サマリ)',
            'GET /v1/drugs/{name}' => '1薬剤の休薬詳細 (name / 別名 / 商品名 で照合)',
        ],
    ], $notice, $JSON);
}

// GET /v1/drugs  … 一覧 (サマリ)
if ($parts[0] === 'drugs' && count($parts) === 1) {
    $list = [];
    foreach ($drugs as $d) {
        $surg = isset($d['surgery']) ? $d['surgery'] : [];
        $cont = isset($d['contrast_ct']) ? $d['contrast_ct'] : [];
        $list[] = [
            'name' => $d['name'],
            'category' => isset($d['category']) ? $d['category'] : null,
            'aliases' => isset($d['aliases']) ? $d['aliases'] : [],
            'brand_names' => isset($d['brand_names']) ? $d['brand_names'] : [],
            // 表示推奨値 (安全側) を 一覧でも 提供
            'surgery_high_risk_days_before' => isset($surg['display_high_risk_days_before']) ? $surg['display_high_risk_days_before'] : null,
            'surgery_low_risk_days_before' => isset($surg['display_low_risk_days_before']) ? $surg['display_low_risk_days_before'] : null,
            'surgery_required' => isset($surg['required']) ? $surg['required'] : null,
            'contrast_required' => isset($cont['required']) ? $cont['required'] : null,
            'contrast_days_before' => isset($cont['display_days_before']) ? $cont['display_days_before'] : null,
        ];
    }
    respond(['count' => count($list), 'drugs' => $list], $notice, $JSON);
}

// GET /v1/drugs/{name}  … 詳細
if ($parts[0] === 'drugs' && count($parts) >= 2) {
    $name = rawurldecode(implode('/', array_slice($parts, 1)));
    $d = findDrug($drugs, $name);
    if ($d === null) {
        respond([
            'error' => 'drug not found',
            'query' => $name,
            'hint' => 'name / 別名 / 商品名 の 完全一致で照合します (あいまい検索は 今後の /v1/search で 提供予定)。',
        ], $notice, $JSON, 404);
    }
    respond(['drug' => $d], $notice, $JSON);
}

respond(['error' => 'unknown endpoint', 'path' => $p], $notice, $JSON, 404);
