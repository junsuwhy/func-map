// 讀站台設定：依序載入 ../.env、./.env（func-map/.env），後者覆蓋前者，環境變數再覆蓋檔案。
// 這裡只放「跟站有關」的設定，換一個 Laravel 站時只要改 .env，不用改程式。說明見 .env.example。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const env = { ...readEnvFile(path.join(ROOT, '..', '.env')), ...readEnvFile(path.join(ROOT, '.env')), ...process.env };
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const startPath = env.FUNC_MAP_START_PATH || '/admin';
const [vw, vh] = (env.FUNC_MAP_VIEWPORT || '1440x900').split('x').map(Number);

export const config = {
  baseUrl: (env.FUNC_MAP_BASE_URL || '').replace(/\/$/, ''),
  // 帳密沿用舊的 BETA_ACCOUNT／BETA_ACCOUNT_PASSWORD 當備援
  account: env.FUNC_MAP_ACCOUNT || env.BETA_ACCOUNT,
  password: env.FUNC_MAP_PASSWORD || env.BETA_ACCOUNT_PASSWORD,
  loginPath: env.FUNC_MAP_LOGIN_PATH || '/login',
  loginEmailSelector: env.FUNC_MAP_LOGIN_EMAIL_SELECTOR || 'input[name=email]',
  loginPasswordSelector: env.FUNC_MAP_LOGIN_PASSWORD_SELECTOR || 'input[name=password]',
  loginSubmitSelector: env.FUNC_MAP_LOGIN_SUBMIT_SELECTOR || 'button[type=submit]',
  startPath,
  scopePrefix: env.FUNC_MAP_SCOPE_PREFIX || startPath,
  seeds: list(env.FUNC_MAP_SEEDS),
  routesFiles: list(env.FUNC_MAP_ROUTES_FILES || '../../routes/web.php').map((f) => path.resolve(ROOT, f)),
  literalSegments: list(env.FUNC_MAP_LITERAL_SEGMENTS),
  // 通用的「有副作用或下載檔案」路徑，再加上各站自己的
  skip: [
    '/logout', '/delete(/|$)', '/destroy(/|$)', '/(xlsx|csv|export|download)(/|$)',
    ...list(env.FUNC_MAP_SKIP),
  ].map((s) => new RegExp(s)),
  navSelector: env.FUNC_MAP_NAV_SELECTOR || 'nav, aside',
  breadcrumbSelector: env.FUNC_MAP_BREADCRUMB_SELECTOR || '.breadcrumb',
  chromeSelector: env.FUNC_MAP_CHROME_SELECTOR || 'header, footer',
  viewport: { width: vw || 1440, height: vh || 900 },
  locale: env.FUNC_MAP_LOCALE || 'zh-TW',
};
