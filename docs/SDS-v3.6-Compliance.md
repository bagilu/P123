# SBI-P-SDS v3.6 遵循與 QA 報告

## 交付範圍

- Web Version：V0.3.0
- Schema：P123-SPACE-0.2.0
- 架構：純前端 HTML、CSS、JavaScript
- 資料庫／登入／RLS：N/A（本版不使用後端或身分驗證）

## 檢查結果

| 項目 | 結果 | 證據／說明 |
|---|---|---|
| ZIP 外層同名資料夾 | PASS | `P123_ParametricRoomBuilder_V0.3.0/` |
| README 與設定範例 | PASS | `README.txt`、`config-sample.js` |
| 正式設定或密鑰未打包 | PASS | 無 `config.js`、無 API 金鑰 |
| Web 版本同步 | PASS | HTML 標題、頁首、頁尾與快取參數皆為 V0.3.0 |
| SDS 頁尾格式 | PASS | 慈濟大學｜經營管理學系｜好玩實驗室 · Web Version V0.3.0 · SBI-P-SDS v3.6 |
| JavaScript 語法 | PASS | `node --check app.js` |
| JSON 語法 | PASS | `data/*.json` 逐檔解析 |
| 房間參數驗證 | PASS | 50–5000 cm，無效時保留最後有效模型 |
| 開口邊界驗證 | PASS | 正值、非負偏移、牆面與高度邊界 |
| 開口重疊驗證 | PASS | 同牆矩形交疊檢查 |
| 範例檔案 | PASS | 一個可編輯參數式範例，另保留三個 V0.2.1 範例 |
| JSON 往返 | PASS | `parametric_room_builder` 可恢復房間與開口參數 |

## 已知限制

Three.js、OrbitControls、CSS2DRenderer 與 GLTFExporter 由 jsDelivr 載入，因此第一次開啟需要網路。V0.3.0 未包含 L 型房間、照片建模、家具或後端服務。
