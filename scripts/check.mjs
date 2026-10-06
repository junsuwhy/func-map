// 檢查 func-map.yaml：
//   1. 內部一致性（edge／flow 引用的 node、group、截圖檔都存在）
//   2. 跟 crawl/raw.json（npm run crawl 的結果）比對，列出 YAML 跟實際網站對不上的地方
//
// 用法：node scripts/check.mjs        有錯誤時 exit code 為 1；只有「對不上」的提醒時為 0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { toPattern } from './crawl.mjs';
import { config } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const y = load(fs.readFileSync(path.join(ROOT, 'func-map.yaml'), 'utf8'));
const errors = [];
const warnings = [];

// ── 1. 內部一致性 ──
const ids = new Set(Object.keys(y.nodes));
for (const e of y.edges) {
  for (const k of ['from', 'to']) if (!ids.has(String(e[k]))) errors.push(`edge 指到不存在的 node：${JSON.stringify(e)}`);
  if (!['link', 'next'].includes(e.type)) errors.push(`edge type 只能是 link 或 next：${JSON.stringify(e)}`);
}
for (const [k, f] of Object.entries(y.flows)) {
  for (const n of f.nodes) if (!ids.has(String(n))) errors.push(`flow ${k} 指到不存在的 node ${n}`);
}
for (const [id, n] of Object.entries(y.nodes)) {
  if (!y.groups[n.group]) errors.push(`node ${id} 的 group「${n.group}」不存在`);
  if (n.screenshot && !fs.existsSync(path.join(ROOT, 'public', n.screenshot))) errors.push(`node ${id} 的截圖不存在：${n.screenshot}`);
  if (!n.screenshot && !n.kind && !n.note) warnings.push(`node ${id}（${n.path}）沒有截圖，也沒有 kind／note 說明原因`);
}
const usedShots = new Set(Object.values(y.nodes).map((n) => n.screenshot).filter(Boolean));
const shotDir = path.join(ROOT, 'public/screens');
if (fs.existsSync(shotDir)) {
  for (const f of fs.readdirSync(shotDir)) if (!usedShots.has(`screens/${f}`)) warnings.push(`截圖沒有 node 使用：screens/${f}`);
}

// ── 2. 跟爬蟲結果比對 ──
const rawFile = path.join(ROOT, 'crawl/raw.json');
if (!fs.existsSync(rawFile)) {
  warnings.push('找不到 crawl/raw.json，略過跟實際網站的比對（先跑 npm run crawl）');
} else {
  const { pages } = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  const byPath = new Map(Object.entries(y.nodes).map(([id, n]) => [n.path, id]));

  for (const pattern of Object.keys(pages)) {
    if (!byPath.has(pattern)) warnings.push(`爬到但 YAML 沒有的頁面：${pattern}（${pages[pattern].heading}）`);
  }
  for (const [id, n] of Object.entries(y.nodes)) {
    if (n.screenshot && !pages[n.path]) warnings.push(`YAML 有截圖、但這次沒爬到的頁面：node ${id} ${n.path}`);
  }

  // 頁面內容裡的連結（側邊選單另外看 node 1）
  const pairKey = (a, b) => [a, b].sort().join('-');
  const yamlPairs = new Set(y.edges.map((e) => pairKey(String(e.from), String(e.to))));
  const crawledPairs = new Set();
  const home = byPath.get(config.startPath);
  for (const [pattern, page] of Object.entries(pages)) {
    const from = byPath.get(pattern);
    const links = [...page.content, ...(pattern === config.startPath ? page.sidebar : [])];
    for (const l of links) {
      const to = byPath.get(toPattern(l.path));
      if (!from || !to || from === to) continue;
      crawledPairs.add(pairKey(from, to));
      if (!yamlPairs.has(pairKey(from, to))) {
        warnings.push(`爬到但 YAML 沒有的連結：${from} ${pattern} → ${to} ${y.nodes[to].path}（「${l.text}」）`);
      }
    }
  }
  for (const e of y.edges) {
    if (e.type !== 'link') continue;
    const a = String(e.from);
    const b = String(e.to);
    const bothCrawled = pages[y.nodes[a].path] && (pages[y.nodes[b].path] || y.nodes[b].kind === 'file');
    if (bothCrawled && !crawledPairs.has(pairKey(a, b)) && a !== home && b !== home) {
      warnings.push(`YAML 有、但這次沒爬到的連結：${a} ${y.nodes[a].path} — ${b} ${y.nodes[b].path}`);
    }
  }
}

// 同一則訊息只印一次
for (const w of [...new Set(warnings)]) console.log('提醒', w);
for (const e of errors) console.log('錯誤', e);
console.log(`\nnodes ${ids.size}、edges ${y.edges.length}、flows ${Object.keys(y.flows).length}；錯誤 ${errors.length}、提醒 ${new Set(warnings).size}`);
process.exit(errors.length ? 1 : 0);
