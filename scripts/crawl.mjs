// 以 Playwright 登入網站，從起始頁（預設 /admin）開始 BFS 爬所有後台頁面（只做 GET，不送任何表單），
// 同一個路由（例如所有 /admin/certapply/{id}）只截第一頁，結果寫到 crawl/raw.json 與 public/screens/。
//
// 用法：node scripts/crawl.mjs [baseUrl]
// 站台設定（網址、登入方式、選擇器…）與帳密都讀 .env，見 scripts/config.mjs 與 .env.example。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, config } from './config.mjs';

const BASE = (process.argv[2] || config.baseUrl).replace(/\/$/, '');
const SHOTS = path.join(ROOT, 'public/screens');
const OUT = path.join(ROOT, 'crawl');
const SAMPLES_PER_PATTERN = 2; // 同一 pattern 最多走訪幾個實例來找連結

// 以 Laravel routes 檔的 GET 路由把實際網址歸類成 pattern（同性質頁面只截一張）
const GET_ROUTES = config.routesFiles
  .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/Route::get\(\s*['"]([^'"]+)['"]/g)])
  .map((m) => '/' + m[1].replace(/^\//, ''))
  .map((uri) => ({
    uri,
    re: new RegExp('^' + uri.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '$'),
    params: (uri.match(/\{/g) || []).length,
  }))
  // 沒有參數的路由優先（/admin/certificate/new 要先於 /admin/certificate/{id}）
  .sort((a, b) => a.params - b.params);

export function toPattern(p) {
  // 共用同一路由、但畫面性質不同的特殊值（例如 edit/_new 是「新增」）
  if (config.literalSegments.some((seg) => p.endsWith('/' + seg))) return p;
  return GET_ROUTES.find((r) => r.re.test(p))?.uri ?? null;
}

const slug = (pattern) => pattern.replace(/^\//, '').replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_') || 'root';

async function main() {
  if (!BASE) throw new Error('沒有設定 FUNC_MAP_BASE_URL（func-map/.env）');
  if (!config.account || !config.password) throw new Error('沒有設定 FUNC_MAP_ACCOUNT / FUNC_MAP_PASSWORD（func-map/.env 或 docs/.env）');
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: config.viewport, locale: config.locale, acceptDownloads: false });
  const page = await ctx.newPage();
  // 登入是整個流程唯一的 POST；登入後才掛上「擋掉非 GET 導覽」的保險
  await page.goto(BASE + config.loginPath);
  await page.locator(config.loginEmailSelector).first().fill(config.account);
  await page.locator(config.loginPasswordSelector).first().fill(config.password);
  await Promise.all([page.waitForLoadState('networkidle'), page.locator(config.loginSubmitSelector).first().click()]);
  await page.goto(BASE + config.startPath);
  if (!new URL(page.url()).pathname.startsWith(config.startPath)) throw new Error(`登入失敗，目前在 ${page.url()}`);
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.method() !== 'GET' && req.isNavigationRequest()) return route.abort();
    return route.continue();
  });
  console.log('logged in');

  const pages = {}; // pattern -> info
  // FUNC_MAP_SEEDS：沒有連結可以點到的頁面在這裡補種子
  const queue = [config.startPath, ...config.seeds];
  const broken = [];
  const visited = new Set();
  const sampleCount = {};

  while (queue.length) {
    const p = queue.shift();
    if (visited.has(p)) continue;
    visited.add(p);
    const pattern = toPattern(p);
    if (!pattern) { broken.push(p); continue; } // 不是 GET 路由（POST-only 或錯誤連結）
    if ((sampleCount[pattern] || 0) >= SAMPLES_PER_PATTERN) continue;
    sampleCount[pattern] = (sampleCount[pattern] || 0) + 1;

    let resp;
    try {
      resp = await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      console.log('ERR', p, e.message.split('\n')[0]);
      continue;
    }
    const finalPath = new URL(page.url()).pathname;
    if (resp && resp.status() >= 400) {
      broken.push(`${p} (${resp.status()})`);
      sampleCount[pattern]--;
      continue;
    }
    const data = await page.evaluate(({ nav, breadcrumb, chrome }) => {
      const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const linksIn = (sel) =>
        [...document.querySelectorAll(sel)].map((a) => ({ href: a.getAttribute('href'), text: text(a).slice(0, 60) }));
      const contentLinks = [...document.querySelectorAll('a[href]')]
        .filter((a) => !a.closest(`${nav}, ${breadcrumb}, ${chrome}`))
        .map((a) => ({ href: a.getAttribute('href'), text: text(a).slice(0, 60) }));
      const forms = [...document.querySelectorAll('form')].map((f) => ({
        method: (f.getAttribute('method') || 'get').toLowerCase(),
        action: f.getAttribute('action') || location.pathname,
        submits: [...f.querySelectorAll('button, input[type=submit]')].map((b) => text(b) || b.value).filter(Boolean).slice(0, 5),
      }));
      return {
        title: document.title,
        heading: text(document.querySelector(`${breadcrumb} > :last-child`)) || text(document.querySelector('h1, h2')),
        breadcrumb: linksIn(`${breadcrumb} a`),
        sidebar: linksIn(`${nav} a`),
        content: contentLinks,
        forms,
      };
    }, { nav: config.navSelector, breadcrumb: config.breadcrumbSelector, chrome: config.chromeSelector });

    const norm = (href) => {
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return null;
      try {
        const u = new URL(href, BASE + p);
        if (u.origin !== new URL(BASE).origin) return null;
        return u.pathname.replace(/\/$/, '') || '/';
      } catch { return null; }
    };
    const out = (list) => list.map((l) => ({ ...l, path: norm(l.href) })).filter((l) => l.path);
    const info = {
      pattern,
      example: p,
      redirectedTo: finalPath !== p ? finalPath : undefined,
      status: resp?.status(),
      title: data.title,
      heading: data.heading,
      breadcrumb: out(data.breadcrumb),
      sidebar: out(data.sidebar),
      content: out(data.content),
      forms: data.forms,
    };

    if (!pages[pattern]) {
      const file = `${slug(pattern)}.png`;
      await page.screenshot({ path: path.join(SHOTS, file) });
      info.screenshot = `screens/${file}`;
      pages[pattern] = info;
      console.log('NEW ', pattern, '|', data.heading);
    } else {
      // 合併第二個樣本找到的連結
      const seen = new Set(pages[pattern].content.map((l) => l.path));
      for (const l of info.content) if (!seen.has(l.path)) pages[pattern].content.push(l);
    }

    for (const l of [...info.sidebar, ...info.content, ...info.breadcrumb]) {
      if (!l.path.startsWith(config.scopePrefix)) continue;
      if (config.skip.some((re) => re.test(l.path))) continue;
      if (!visited.has(l.path)) queue.push(l.path);
    }
  }

  fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({ base: BASE, crawledAt: new Date().toISOString(), broken: [...new Set(broken)], pages }, null, 2));
  console.log('done', Object.keys(pages).length, 'patterns');
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
