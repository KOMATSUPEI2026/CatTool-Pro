# 校譯台 Design Token 盤點與收斂計畫

> 撰寫日期：2026-07-16
> 背景：原「校譯台_UI重構交接文件.md」的 Chakra UI 遷移計畫經討論後**作廢**（理由：單人維護、設計系統已自建完備、框架帶來依賴跑步機與 AI v2/v3 混寫風險，維護性收益為負）。本文件是替代方案的第一步：**不換框架，收斂現有 `cat-tool.css` 的變數系統**，消除魔術數字、修復尺寸耦合。
> 原則：所有改動皆為「等值替換」（值換成變數，算出來的樣式完全相同），零視覺變化、零邏輯變動，`npm run build` ＋目視比對即可驗證。

---

## 1. 現況體檢：底子很健康

`cat-tool.css` 全檔 693 行，體檢結果比預期好很多：

| 檢查項 | 結果 |
|---|---|
| 字級刻度（10/12/14/16/24px） | ✅ 全數合規，無違例 |
| spacing 偶數規則 | ✅ 合規（唯一奇數 27px 是背景格線紋理的條紋間隔，非 spacing） |
| 圓角刻度（2/4/6/8/10/20px＋50%） | ✅ 值全在刻度上，但大量硬編碼（見 §3.2） |
| 色彩變數化＋雙主題 | ✅ 22 個變數含明暗完整對應，僅少數硬編碼漏網（見 §3.6） |
| z-index | ✅ 已是乾淨的階梯（50→100），只差沒變數化 |
| 縮放系統 | ✅ `--text-scale` / `--ui-pad-scale` / `--side-scale` 運作中 |

結論：**這不是重構，是補漆。**問題集中在「值對了但沒收進變數」，導致同一個決策散落多處、改一處漏一處。

## 2. 現有 token 清單（既有 CSS 變數，維持不動）

### 2.1 色彩（`:root` 亮色 ↔ `:root[data-theme="dark"]` 暗色）

| 變數 | 亮 | 暗 | 用途 |
|---|---|---|---|
| `--paper` | #E7E4DC | #1B1A17 | 頁面紙底 |
| `--paper-card` | #FBFAF7 | #242220 | 卡片底 |
| `--ink` | #272522 | #E8E4DA | 主文字 |
| `--ink-soft` | #5B5750 | #A39D90 | 次要文字 |
| `--line` | #D6D1C4 | #3A372F | 邊框 |
| `--vermilion` | #B33A2E | #D9614E | 朱紅主色 |
| `--vermilion-soft` / `-soft2` | 10%/22% | 16%/32% | 朱紅淡底（術語命中） |
| `--seal` | #1F5C5C | #5FB8B8 | teal 輔色（確認態） |
| `--seal-soft` / `-soft2` | 10%/25% | 14%/30% | teal 淡底 |
| `--progress-translate` / `--progress-confirm` | 淺一階 @60% | 淺一階 @60% | 進度條 |
| `--surface-input` | #ffffff | #2B2925 | 輸入框底 |
| `--grid-rgba` / `--hover-tint` | 墨 3.5%/2.5% | 白 3.5%/4.5% | 格線／懸停 |
| `--tooltip-bg` / `--tooltip-text` | #272522 / #F2EFE8 | #0F0E0C / #F2EFE8 | 深底提示 |
| `--accent-strong` / `--accent-strong-text` | 墨/紙白 | 反轉 | 主按鈕 |
| `--handle-active-tint` | 白 34% | 米白 30% | 側欄把手作用態 |

### 2.2 尺度

- `--radius: 6px`（但只被用了 4 次，見 §3.2）
- `--text-scale: 1`（1.2/1.4 檔）、`--ui-pad-scale: 1`（放大檔為 1.1）、`--side-scale: 1`（側欄局部，由 JSX inline style 動態注入——此為功能設計，不收斂）

## 3. 魔術數字盤點（按收斂優先序）

### 3.1 字體家族 —— 最大宗，P1

三組字串字面量全檔重複，是改字體時最容易漏的地方：

| 建議變數 | 值 | 出現次數 |
|---|---|---|
| `--font-ui` | `"Noto Sans TC", sans-serif` | 21 處 |
| `--font-display` | `"Noto Serif TC", serif` | 約 18 處（27 處含 JP fallback 重疊） |
| `--font-src` | `"Noto Serif JP", "Noto Serif TC", serif` | 9 處＋1 處 JSX inline（TmTab.jsx:68） |

### 3.2 圓角 —— P1

`--radius: 6px` 存在但只有 `.card`、`.sr-bar`、`.doc-context-bar`、`.seg` 在用；其餘全硬編碼：`4px` × 22 處、`6px` × 9 處、另有 2px／8px／10px／20px 散落。建議補齊刻度：

```css
--radius-xs: 2px;   /* term-hit */
--radius-sm: 4px;   /* 輸入框、小按鈕、chip */
--radius:    6px;   /* 卡片基準（既有） */
--radius-lg: 8px;   /* modal、welcome-card */
--radius-md2:10px;  /* 進度軌、膠囊小徽章 */
--radius-pill:20px; /* icon-btn、punct-bar、scroll-capsule */
```

（命名可再議；50% 保持字面量即可，圓形語意明確。）

### 3.3 尺寸耦合 —— 最危險的一類，P1

值本身不髒，但**多處必須同步改**，改一漏一就壞版面：

| 值 | 耦合點 | 建議變數 |
|---|---|---|
| `300px` | 側欄寬 ×2（tm/pv）＋把手 `shifted` 位移 ×2，共 4 處 | `--side-w` |
| `1180px` | `.wrap` 最大寬＋`.scroll-capsule` 的 `right: calc((100vw - 1180px)/2 - 40px)`，共 2 處 | `--wrap-w` |

### 3.4 z-index 階梯 —— P2

值已是乾淨階梯，變數化後語意自明、日後插層不用翻全檔：

```css
--z-tip: 50;        /* 術語 tooltip */
--z-selection: 60;  /* 選取加詞按鈕 */
--z-side: 70;       /* 側欄、標點列（把手 +1 = 71，可寫 calc(var(--z-side) + 1)） */
--z-capsule: 80;    /* 置頂置底膠囊 */
--z-modal: 90;      /* Modal 遮罩 */
--z-welcome: 95;    /* 歡迎面板 */
--z-toast: 100;     /* Toast（設計註解言明須高於 Modal） */
```

### 3.5 陰影層級 —— P2

14 處 box-shadow 可收斂為四級（透明度差異依深底/淺底元件分兩檔屬合理，收斂時保留現值）：

| 建議變數 | 值 | 現用元件 |
|---|---|---|
| `--shadow-1` | `0 2px 6px rgba(0,0,0,.18)` | tooltip 側鈕（把手的 `±2px 0 8px .2` 方向性陰影可併入或保留字面量） |
| `--shadow-2` | `0 4px 12px rgba(0,0,0,.14)` | 膠囊、標點列、選取加詞鈕（.3 深一檔） |
| `--shadow-3` | `0 6px 18px rgba(0,0,0,.3)`（側欄為 `±6px 0 20px .12` 方向性） | term-tip、toast、側欄 |
| `--shadow-4` | `0 12px 32px rgba(0,0,0,.3)`（welcome 為 .15） | modal、welcome-card |

暗黑模式陰影目前僅標點列有特調（`.5`），其餘沿用——屬既有取捨，不在本次範圍。

### 3.6 硬編碼色彩漏網 —— P2

| 值 | 位置 | 處理建議 |
|---|---|---|
| `#F6E9E5` | seal-mark 印章文字 ×2（header＋welcome） | 收為 `--seal-mark-text` |
| `#fff` | 朱紅/teal 實底上的白字 ×約 10 處 | 收為 `--on-accent: #fff`（兩主題朱紅/teal 都夠深，白字皆成立） |
| `#ADFF2F`＋`#1B1A17` | 術語 tooltip 的候選編號 chip（螢光綠） | 收為 `--chip-highlight` / `--chip-highlight-text`；此為刻意的高視認性設計，保留值 |
| `#8A857A` | tooltip 分隔符 `.sep` | 收為 `--tooltip-sep`（雙主題共用深底，固定值合理） |
| `rgba(20,18,15,0.5)` | modal 遮罩 | 收為 `--overlay` |
| `rgba(163,157,144,.4)` | 暗黑標點列邊框 ×2 | 收為暗黑區塊局部變數或保留（僅 2 處、同一區塊） |

### 3.7 低優先／建議不動 —— P3

- **行高**：`1 / 1.5 / 1.6 / 1.8 / 1.9 / 2 / 2.1` 七檔。`1.9→1.8`、`2.1→2` 理論上可併，但這些是中日文排版的手調結果（原文行高 2 vs 譯文 1.8 是刻意差異），**併檔會產生視覺變化，違反等值替換原則**——先變數化不併值，或乾脆不動。
- **letter-spacing**：`.02/.03/.04/.06/.08/.2em` 六檔，各有語意（標題/標籤/表頭/直排把手），重複度低，不動。
- **transition 時長**：`.12/.15/.2/.22/.25s`，可收斂為 fast(.15)/base(.22)，但屬微調非等值替換，緩辦。
- **modal 寬度** `360/440/720px`：已有 class 語意（`-wide`/`-xl`），不需變數。

## 4. JSX inline style 盤點（29 處）

絕大多數是**功能性**而非樣式性，不需處理：

- display 條件切換（空狀態、無搜尋結果）×10、進度條動態寬 ×2、`--side-scale` 動態注入 ×2 —— 這些是 React 邏輯，保留
- 表格欄寬（`width: 110/80/36/'24%'/'40%'`）×8 —— 欄寬語意跟著表格走，保留 inline 屬合理
- 真正該收的只有 1 處：**TmTab.jsx:68** 的 `fontFamily: "'Noto Serif JP',…"` 字面量——建議改掛既有的 `td.ja` class（TermsTab 走的就是這條路），與 §3.1 同批處理

## 5. 執行計畫（2026-07-16 批 1～4 已全數完成）

一批一 commit，每批 `npm run build` ＋computed style 驗證＋現役 Puppeteer 測試（r3～r6＋phase0）全綠：

| 批次 | 內容 | 風險 | 狀態 |
|---|---|---|---|
| 批 1 | §3.1 字體變數 ×3＋TmTab.jsx:68 改 class | 極低（純等值替換） | ✅ 完成（95a2b46） |
| 批 2 | §3.3 尺寸耦合 `--side-w`／`--wrap-w` | 極低（4＋2 處） | ✅ 完成（f721888） |
| 批 3 | §3.2 圓角刻度補齊 | 低（處數多，逐條替換） | ✅ 完成（8c10d4e） |
| 批 4 | §3.4 z-index＋§3.5 陰影＋§3.6 色彩漏網 | 低 | ✅ 完成（5e3b52a） |
| 緩辦 | §3.7 全部 | ——（涉及視覺變化，另案討論） | ⏸ 未動 |

批 4 實作備註：方向性陰影（側欄 ±6px、把手 ±2px）與獨份值（welcome 卡 .15、選取加詞鈕 14px、暗黑標點列 .5）依計畫保留字面量；`.zh-chip` 的 `#fff` 一併收進 `--on-accent`（深底 tooltip 上的白字，語意同屬強底色白字）；把手 z-index 71 寫為 `calc(var(--z-side) + 1)`。

**禁區不變**：`store.js`、`workActions.js`、`cloud.js`、`utils.js` 邏輯零碰觸；WorkTab.jsx 僅在「批 1 若涉及」時做等值 class 替換（實查後批 1 不涉及 WorkTab.jsx，僅 TmTab.jsx 一處）。CSS 檔內 WorkTab 相關區段的等值替換安全（樣式值不變）。

**驗證**：每批完成後跑 `tests/` 現役 Puppeteer 測試（斷言綁 class 名與資料層，等值替換不應影響）；設計規範刻度掃描照舊。
