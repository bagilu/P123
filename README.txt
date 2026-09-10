P123 空間模型 V0.1 — JSON Viewer
================================

使用方式
1. 解壓縮 ZIP。
2. 以 Chrome、Edge 或 Firefox 開啟 index.html。
3. 網頁會直接顯示內建的 3×6×3 公尺基準空間。
4. 拖曳可旋轉，滾輪或雙指可縮放。
5. 可切換 3D、俯視、正面與側面視角。
6. 「開啟 JSON」可讀取 data 資料夾中的測試檔或其他相容檔案。
7. 「匯出 GLB」可將目前模型輸出成 GLB。

注意事項
- 本版本使用線上 Three.js 程式庫，第一次開啟時需要網際網路。
- P123 V0.1 只支援以 meter 為單位的 JSON。
- JSON 是主要資料；GLB 是供 SketchUp 等軟體觀看的衍生模型。
- 網頁尺寸文字不會作為 SketchUp 原生尺寸物件匯入。

檔案
- index.html：觀看器入口
- app.js：3D 建模、操作與匯出程式
- styles.css：介面樣式
- data/P123_EmptyRoom_3x6x3m.json：3×6×3 公尺測試模型
