# AGENTS.md — 後台功能畫布（func-map）

給 AI agent（Claude Code、Codex、Antigravity…）與人類的作業說明：怎麼從程式碼和測試站產生、更新 `func-map.yaml` 與截圖。
站台設定（網址、登入方式、選擇器…）都在 `.env`，程式本身不綁特定網站；這份 `func-map.yaml` 是 AIATC 後台的內容。
畫布本身怎麼開、檔案各是什麼，看 `README.md`。

## 先搞清楚：每種資訊從哪裡來

`func-map.yaml` 是**手寫維護**的檔案。爬蟲不會改它；爬蟲只產生截圖和 `crawl/raw.json` 當作素材。

| YAML 裡的東西 | 來源 | 自動？ |
|---|---|---|
| node（有哪些頁面） | `routes/web.php` 的 GET 路由 ＋ 爬蟲實際爬到的頁面 | 半自動：爬蟲列出，人／agent 決定要不要放 |
| node 的 `name` | 頁面麵包屑最後一節、左側選單文字（`raw.json` 的 `heading`） | 手寫 |
| `screenshot` | Playwright 截圖 `public/screens/` | 自動 |
| `type: link` 的線 | 爬蟲抓到的頁面內連結（`raw.json` 的 `content`） | 半自動：`check.mjs` 會列出缺的 |
| `type: next` 的箭頭 | 讀 controller：POST 處理完 `redirect(route(...))` 或 `view('alert', ['next' => ...])` 到哪 | 手寫（爬蟲不送表單，看不到） |
| `flows`（篩選器）與步驟順序 | 試算表「AIATC所有記錄by書懷」的「功能需求總驗收」分頁 ＋ 對操作流程的判斷 | 手寫 |

為什麼要用 Playwright，而不是只讀程式碼：
- 截圖只能靠它。
- 這個專案很多列表的連結是在 controller 裡組陣列、交給 `layouts.admin_table_page` 畫出來的，讀 Blade 抓不到，要實際渲染才知道頁面上有哪些連結。
- 順便驗證頁面能不能開（壞掉的連結、會報錯的路由會出現在 `crawl/raw.json` 的 `broken`）。

## 安全規則（一定要遵守）

1. **只對測試站（AIATC 是 beta 站）或本機 docker 爬，不要爬正式站。** 網址在 `.env` 的 `FUNC_MAP_BASE_URL`。
2. **不要讀、印出或 commit 密碼。** 帳密在 `func-map/.env`（`FUNC_MAP_ACCOUNT`／`FUNC_MAP_PASSWORD`）或 `docs/.env`（`BETA_ACCOUNT`／`BETA_ACCOUNT_PASSWORD`），`scripts/config.mjs` 會自己讀；只需要確認 key 存在時用 `grep -o '^[A-Z_]*=' .env ../.env`。前端只會拿到 `FUNC_MAP_BASE_URL`（`vite.config.js` 的 `define`），不要改成用 Vite 的 `envPrefix` 暴露 `FUNC_MAP_*`。
3. **截圖含個資，不進版控。** `public/screens/`、`crawl/`、`dist/`、`.env` 都在 `func-map/.gitignore`（資料夾自帶，複製到其他站也有效）；不要把截圖搬到其他會被追蹤的路徑。
4. **爬蟲只做 GET，不送表單。** 登入是唯一的 POST；登入後 `crawl.mjs` 會擋掉所有非 GET 的頁面導覽。有副作用或會下載檔案的連結（logout、reloadi18n、downloadi18n、xlsx、delete…）由 `scripts/config.mjs` 內建的清單加上 `.env` 的 `FUNC_MAP_SKIP` 跳過，新增類似路由時要補進 `FUNC_MAP_SKIP`。
5. **爬到的網站問題（壞連結、報錯的路由、逾時的頁面）不要寫進任何會進版控的檔案**（AGENTS.md、README、YAML 的 note、commit message、PR 說明都不行），有資安風險；只在對話中口頭回報給使用者。
6. 「送出表單後才出現的畫面」（匯入預覽、更改場次確認）不要為了截圖去 beta 送表單；需要截圖的話在本機 docker 做。

## 步驟

### 1. 準備

```bash
cd docs/func-map
npm install
npx playwright install chromium   # 第一次
cp .env.example .env              # 第一次；確認 FUNC_MAP_BASE_URL 指向測試站
```

### 2. 看程式碼有哪些後台頁面

```bash
grep -n "Route::get('/admin" ../../routes/web.php
```

跟 `func-map.yaml` 的 `nodes` 對照，記下新增或刪掉的路由。左側選單在 `../../resources/views/layouts/admin.blade.php` 開頭的 `$menus`，決定 node 的 `group`。

### 3. 爬測試站、截圖

```bash
npm run crawl                              # 爬 .env 的 FUNC_MAP_BASE_URL
npm run crawl -- http://localhost:8081     # 或本機 docker
```

- 會清空並重建 `public/screens/`，產生 `crawl/raw.json`（`pages`：每種路由的標題、側邊選單、頁內連結、表單；`broken`：非 GET 路由或回 4xx/5xx 的網址）。
- 網址用 `routes/web.php` 的 GET 路由歸類，同一路由只截第一頁、最多走訪 2 個實例找連結；`/_new` 結尾的另成一類。
- 截圖檔名：路由去掉 `{}`、非英數字換成 `_`，例如 `/admin/certapply/{id}` → `screens/admin_certapply_id.png`。
- 沒有連結可以點到的頁面（例如團體審核單在 beta 沒有待審資料時），在 `.env` 的 `FUNC_MAP_SEEDS` 補種子網址。
- 看一下 `broken`：除了 POST-only 路由之外的項目通常是網站的 bug，在對話中回報給使用者，不要寫進檔案。

### 4. 比對 YAML 跟爬蟲結果

```bash
npm run check
```

- **錯誤**（exit 1）：YAML 內部引用壞掉，例如 edge 指到不存在的 node、截圖檔不存在。一定要修。
- **提醒**：YAML 跟實際網站對不上——爬到但 YAML 沒有的頁面／連結、YAML 有但這次沒爬到的頁面／連結、沒被使用的截圖。逐條判斷要補進 YAML 還是可以忽略（例如 beta 剛好沒資料所以沒出現連結）。

### 5. 更新 `func-map.yaml`

格式說明寫在檔案開頭的註解。規則：

- **node 編號不要重排或重用**，新頁面接在最後一個編號後面；刪掉的頁面直接移除該 node 與相關 edge／flow。
- `path` 用 `routes/web.php` 的寫法（保留 `{certificate_id}` 這類參數名）；送出表單後的畫面寫成 `POST /admin/...` 並設 `kind: result`；下載檔案設 `kind: file`。
- 沒有截圖的 node 要在 `note` 寫原因。
- `type: link` 是無方向的線，兩頁互相連結只寫一條。**側邊選單的連結只從 node 1（/admin）連出去**，不要每頁都連，否則滿版都是線。麵包屑的回上層連結不畫。
- `type: next` 要寫 `label`（觸發動作，例如「送出新增」「③ 確認匯入」）。找法：

  ```bash
  grep -n "public function .*Post\|redirect(\|'next' =>" ../../app/Http/Controllers/Admin*.php
  ```

  已經有 `next` 箭頭的兩頁，不用再寫 `link`（畫面會自動省略重複的線）。
- `flows`：`source` 寫對應試算表的「類型／項目」；**`nodes` 的順序就是畫面上「上一步／下一步」的步驟順序**，照實際操作順序排，通常從 1 開始。
- 試算表用 Google Drive 工具讀取（file id `1Tj4ijIHpGlgUMRcdbSsoy77gh84N9BNmExOjJo-hdnU`）；`read_file_content` 只會回每個分頁的前幾列，要完整內容請用 `download_file_content` 匯出成 xlsx 再用 openpyxl 讀「功能需求總驗收」分頁。

### 6. 驗證

```bash
npm run check    # 必須 0 錯誤，提醒都要判斷過
npm run build    # 必須成功
npm run dev      # 開 http://localhost:5180 實際看
```

在瀏覽器確認：新 node 有出現在正確的分類區塊、截圖正常、選每個篩選器時相關 node 有亮起來、「開始 ▶／下一步 ▶」逐步走一遍順序合理。

### 7. 交付

- `docs/` 是獨立 repo（`aiatc.tw-docs`），commit 在 `docs/` 裡做，不是主 repo。不追蹤 `node_modules/`、`dist/`、`crawl/`。
- 截圖與 `.env` 不 commit（已在 `.gitignore`）；commit 前用 `git add --dry-run` 確認沒有混進去。
- 回報時列出：新增／移除的 node、`broken` 裡發現的網站問題（只在對話中說）、`check` 留下沒處理的提醒與原因。
