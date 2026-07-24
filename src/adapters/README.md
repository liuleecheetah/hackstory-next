# adapters（第 2 層）

匯入匯出：CSV / Google Sheet / JSON / 圖片 / Markdown 大事記。

- 匯入：`csv.ts`、`gsheet.ts`、`json.ts`、`remote.ts`（從公開網址載入）
- 表格分流：`rows.ts`（表頭別名對應、`RawRow`、SPEC 第 9 節髒資料分流。時間解析借用 `core/time.ts`）
- 匯出：`export.ts`（.hst.json / SVG / PNG / iframe）、`markdown.ts`（Markdown 大事記）

Markdown 是「翻譯格式」而非儲存格式：匯出成給人讀的中文大事記，要完整資料仍用 .hst.json（見 `docs/share-plan.md`）。

**鐵律：** 只能呼叫 `core`。新增一種匯入格式時，只動這一層。
