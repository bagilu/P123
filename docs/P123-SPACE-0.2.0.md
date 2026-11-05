# P123-SPACE-0.2.0

P123 V0.3.0 的參數式矩形房間交換格式。幾何資料以 `meter` 儲存，使用者輸入值以 `centimeter` 儲存於 `parameters`。

## 物件與參數

| 類型 | 編號 | 說明 |
|---|---|---|
| 房間 | `R001` | 矩形地板及空間範圍 |
| 牆面 | `W001`–`W004` | 前、右、後、左牆 |
| 開口 | `O001` 起 | 門、窗或一般矩形開口 |
| 參數 | `A001` 起 | 與物件屬性分離的公分數值 |

`A001`、`A002`、`A003` 固定對應房間的 `width`、`length`、`height`。每個開口產生四個參數，依序為 `width`、`height`、`left`、`bottom`。

## 開口座標

- `hostWallId`：所在牆面。
- `left`：人在室內面向牆面時，由該牆左側量至開口左緣。
- `bottom`：由地板量至開口下緣。
- `width`、`height`：開口尺寸。

必須滿足：`left >= 0`、`bottom >= 0`、`left + width <= wall length`、`bottom + height <= room height`。同一牆面上的開口不得相互重疊。

## 相容性

- `modelType: parametric_room_builder` 且具備本格式欄位時，可重新進入編輯模式。
- `P123-SPACE-0.1.0` 與其他舊版／複合格式以唯讀模式開啟，保留原始資料。
- 目前只支援矩形地板模板；後續形狀須提升 schema 版本或以相容欄位擴充。
