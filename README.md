# AIATC 後台功能畫布（func-map）

把 `/admin` 底下每一種頁面畫成一張 [React Flow](https://reactflow.dev/) 畫布：每個 node 是一種頁面（附截圖），
頁面之間的連結畫成線，業務流程的下一步畫成箭頭；上方篩選器可以只看某個業務邏輯，其他 node 與線會淡掉。

## 檔案

| 檔案 | 用途 |
|---|---|
| `func-map.yaml` | **畫布的唯一資料來源**：nodes、edges、flows（業務邏輯篩選器）、groups。改名稱、加線、調整篩選器都改這裡 |
| `.env` | 站台設定：網址、登入方式、選擇器、路由檔位置…（不進版控，從 `.env.example` 複製） |
| `scripts/config.mjs` | 讀 `.env` 的站台設定 |
| `scripts/crawl.mjs` | 用 Playwright 登入網站、從起始頁爬所有後台頁面並截圖到 `public/screens/`，連結資料寫到 `crawl/raw.json`（兩者都不進版控：截圖含個資） |
| `scripts/check.mjs` | 檢查 YAML 內部引用、並跟 `crawl/raw.json` 比對列出對不上的頁面與連結（`npm run check`） |
| `AGENTS.md` | 更新畫布的完整作業步驟（給 AI agent 與人類） |
| `src/` | 畫布網頁（Vite + React + @xyflow/react，排版用 dagre） |

## 使用

```bash
cd docs/func-map
npm install
npm run dev          # http://localhost:5180
npm run build        # 輸出到 dist/，可直接用任何靜態伺服器開
```

## 重新截圖

站台設定放在 `func-map/.env`，帳密放在 `func-map/.env`（`FUNC_MAP_ACCOUNT`／`FUNC_MAP_PASSWORD`）或上一層 `docs/.env`（`BETA_ACCOUNT`／`BETA_ACCOUNT_PASSWORD`），兩個 `.env` 都不進版控：

```bash
cp .env.example .env   # 再填入帳密或調整設定
```

截圖含個資，不進版控；新 clone 下來的人要自己跑一次 `npm run crawl` 才看得到圖。

```bash
npx playwright install chromium   # 第一次
npm run crawl                      # 爬 .env 的 FUNC_MAP_BASE_URL
npm run crawl -- http://localhost:8081   # 改爬本機 docker
```

爬蟲只會開 GET 頁面，不送任何表單；`logout`、`reloadi18n`、`downloadi18n`、`xlsx` 下載、`delete` 等有副作用的連結會跳過。
頁面網址用 `routes/web.php` 的 GET 路由歸類，同一個路由（例如所有 `/admin/certapply/{id}`）只截第一頁。

爬完後跑 `npm run check`，再依 `AGENTS.md` 的步驟手動更新 `func-map.yaml`（爬蟲不會改 YAML）。

## 用在其他 Laravel 站

把整個 `func-map/` 資料夾複製到該站（預設假設放在 `<laravel 根目錄>/docs/func-map/`，路由檔是 `../../routes/web.php`），然後：

1. 照 `.env.example` 寫該站的 `.env`：網址、登入頁與選擇器、起始路徑、側邊選單／麵包屑的 CSS 選擇器、要跳過的網址。
2. 清空 `func-map.yaml` 的 `groups`、`nodes`、`edges`、`flows`，跑 `npm run crawl` 後照 `AGENTS.md` 重新整理。

限制：路由只抓 `Route::get('...')` 的寫法；用 `Route::prefix()->group()` 或 `Route::resource()` 定義的路由抓不到完整網址，會被當成「不是 GET 路由」記在 `raw.json` 的 `broken`。

## 沒有截圖的 node

- `kind: file`：點下去是下載檔案（Excel、語系檔）
- `kind: result`：送出表單後才會出現的畫面（例如匯入預覽、更改場次確認），爬蟲不送表單所以沒有截圖
- 團體申請審核頁：beta 目前沒有待審的申請
