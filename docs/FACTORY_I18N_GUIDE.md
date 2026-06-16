# Factory Screens — i18n Translation Guide

**System**: Pixie Girl Hub admin app (`apps/admin`)  
**Scope**: Factory-facing screens only — China Factory Account ledger and shipments  
**Library**: react-i18next with Vite glob-based auto-discovery  
**Currently supported**: `en` (English), `zh` (Simplified Chinese — 简体中文)

---

## How to add a new language

Adding a language requires **no frontend code changes**. Two files only:

### Step 1 — Create the translation file

Create a new file at:
```
apps/admin/src/i18n/locales/<language-code>.json
```

Examples: `ko.json` for Korean, `fr.json` for French, `ar.json` for Arabic.

The file must contain all keys listed in the **Key Reference** section below.
Use the AI Prompt at the bottom of this document to generate it.

### Step 2 — Register the display name

Open `apps/admin/src/i18n/language-names.json` and add one line:

```json
{
  "en": "English",
  "zh": "简体中文",
  "ko": "한국어"
}
```

That's it. On next deploy, the language selector dropdown on the Production page
automatically includes the new language. No frontend code touched.

---

## Architecture overview

```
apps/admin/src/i18n/
  index.ts              ← i18next setup; auto-discovers locales via import.meta.glob
  language-names.json   ← maps code → native display name (drives the UI dropdown)
  locales/
    en.json             ← English keys (source of truth)
    zh.json             ← Simplified Chinese
    <code>.json         ← drop a new file here → auto-picked up
```

**Language preference** is stored in `localStorage` under the key `pgh-lang`.
Factory manager users (`factory_manager` role) default to Chinese on first visit
if no preference has been stored yet. Any user can override via the dropdown.

**Namespace**: `factory` — translations are scoped to this namespace.
Usage in components: `const { t } = useTranslation("factory"); t("key")`

**Interpolation**: Some keys use `{{variable}}` placeholders (see `reconcile`).
Preserve these exactly in translated strings.

---

## Key Reference

All 61 keys that must appear in every locale file.
The table shows the key name, English text, Chinese text, and context notes.

| Key | English | Chinese (简体) | Context / Notes |
|-----|---------|---------------|-----------------|
| `currentBalance` | Current Balance | 当前余额 | Header above the main ¥ balance figure |
| `alertThreshold` | Alert threshold | 预警阈值 | Label next to the configured alert limit |
| `reconcile` | Reconcile ({{count}}) | 对账 ({{count}}) | Button — {{count}} = number of rows selected; keep the placeholder |
| `addEntry` | Add Entry | 添加记录 | Primary button to open the Add Ledger Entry drawer |
| `balanceExceeded` | Balance has exceeded the alert threshold. Please arrange payment. | 余额已超过预警阈值，请及时付款。 | Warning banner shown when balance ≥ alert threshold |
| `date` | Date | 日期 | Table column header — transaction date |
| `type` | Type | 类型 | Table column header — entry type (payment, charge, etc.) |
| `description` | Description | 描述 | Table column header and form field label |
| `debit` | Debit | 借方 | Table column header; also used as a direction toggle button |
| `credit` | Credit | 贷方 | Table column header; also used as a direction toggle button |
| `balance` | Balance | 余额 | Table column header — running balance |
| `reconCol` | Recon. | 对账 | Table column header — reconciliation tick mark column (short label) |
| `noEntries` | No ledger entries yet | 暂无记录 | Empty state title when the ledger has no rows |
| `noEntriesMsg` | Order charges and payments will appear here. | 订单收费和付款将显示在这里。 | Empty state subtitle |
| `failedToLoad` | Failed to load | 加载失败 | Error state title (used for both ledger and shipments) |
| `couldNotLoadEntries` | Could not load ledger entries. | 无法加载账户记录。 | Error state message for the ledger table |
| `couldNotLoadShipments` | Could not load shipments. | 无法加载发货记录。 | Error state message for the shipments panel |
| `retry` | Retry | 重试 | Button in error states |
| `addLedgerEntry` | Add Ledger Entry | 添加账户记录 | Drawer title — opens the form to add a new ledger row |
| `cancel` | Cancel | 取消 | Secondary / ghost button in drawers |
| `saving` | Saving… | 保存中… | Spinner label while an API mutation is in flight |
| `saveEntry` | Save Entry | 保存 | Primary button in the Add Ledger Entry drawer |
| `entryType` | Entry Type | 类型 | Field label in Add Ledger Entry form |
| `amount` | Amount | 金额 | Field label — monetary amount |
| `currency` | Currency | 货币 | Field label — currency selector (CNY / NGN / USD) |
| `fxRate` | FX Rate to CNY | 汇率（转换为CNY） | Field label — exchange rate from original currency to Chinese Yuan |
| `paymentMethod` | Payment Method | 付款方式 | Field label — how the payment was made |
| `selectPrompt` | — Select — | — 选择 — | Placeholder option in select dropdowns (the "no selection" item) |
| `paidBy` | Paid By | 付款人 | Field label — name of person or entity who made the payment |
| `paidByPlaceholder` | Person / entity name | 付款人姓名 | Input placeholder for the Paid By field |
| `descriptionPlaceholder` | Short description (optional) | 备注（选填） | Input placeholder for the Description field |
| `all` | All | 全部 | Filter chip — shows all shipment statuses |
| `newShipment` | New Shipment | 新建发货单 | Button to open the Create Shipment drawer |
| `noShipments` | No shipments yet | 暂无发货记录 | Empty state title when no shipments have been logged |
| `noShipmentsMsg` | When the factory dispatches goods, log the shipment here. | 工厂发货后，记录在这里。 | Empty state subtitle for shipments |
| `items` | items | 件 | Suffix after item count on shipment cards, e.g. "3 items" / "3件" |
| `shipped` | Shipped | 发货 | Label for the shipment dispatch date |
| `estimatedArrival` | Est. arrival | 预计到达 | Label for the expected arrival date |
| `courier` | Courier | 快递公司 | Field label — courier/logistics company name |
| `tracking` | Tracking | 追踪号 | Label for tracking number in shipment detail drawer |
| `shippingFee` | Shipping Fee | 运费 | Field label — cost of shipping/freight |
| `itemsLabel` | Items | 货物明细 | Section heading for the list of goods inside a shipment |
| `advanceStatus` | Advance Status | 更新状态 | Button to open the status-advance panel inside a shipment drawer |
| `advanceTo` | Advance to | 更新为 | Label above the status selection buttons when advancing |
| `updating` | Updating… | 更新中… | Spinner label while the status change is being saved |
| `confirm` | Confirm | 确认 | Button to confirm the status advance |
| `createShipment` | Create Shipment | 创建发货单 | Primary button in the Create Shipment drawer |
| `courierPlaceholder` | e.g. DHL, FedEx, Yanwen | 如：DHL、FedEx | Placeholder for the Courier input field |
| `trackingNumber` | Tracking Number | 追踪号 | Field label for tracking number in the Create Shipment form |
| `trackingPlaceholder` | Optional | 追踪号（选填） | Placeholder for the Tracking Number field |
| `shippedDate` | Shipped Date | 发货日期 | Field label for the date goods were dispatched |
| `unitPrice` | Unit Price ¥ | 单价(CNY) | Field label — per-unit price in Chinese Yuan |
| `qty` | Qty | 数量 | Field label — quantity of units |
| `add` | Add | 添加 | Small button to add another item row in the shipment form |
| `noFactoryAccounts` | No factory accounts | 暂无工厂账户 | Empty state title when no factory accounts exist |
| `noFactoryAccountsMsg` | No factory accounts have been set up yet. | 尚未设置工厂账户。 | Empty state subtitle |
| `ledger` | Ledger | 账户记录 | Sub-tab label — shows the account ledger |
| `shipmentsTab` | Shipments | 发货记录 | Sub-tab label — shows the shipments list |
| `shipment` | Shipment | 发货单 | Title in the shipment detail drawer when the ref hasn't loaded yet |
| `langToggle` | EN | 中文 | Language label shown on the selector when this language is active |

> **Note**: Entry type labels (`payment`, `charge`, `credit_note`, etc.) and
> shipment status labels (`dispatched`, `in_transit`, `received`, etc.) are
> defined in `apps/admin/src/pages/production/constants.ts` under the
> `ENTRY_TYPE_META` and `SHIPMENT_STATUS_META` objects. Each entry has a
> `label` (English) and `labelZh` (Chinese) property. When adding a new
> language, also update those constant objects.

---

## Entry Type labels (from constants.ts)

These live in `constants.ts` and must be updated there, not in the JSON:

| `entry_type` key | English | Chinese |
|-----------------|---------|---------|
| `payment` | Payment | 付款 |
| `charge` | Charge | 收费 |
| `credit_note` | Credit Note | 退款/抵扣 |
| `advance` | Advance | 预付款 |
| `adjustment` | Adjustment | 调整 |

## Shipment Status labels (from constants.ts)

| `status` key | English | Chinese |
|-------------|---------|---------|
| `dispatched` | Dispatched | 已发货 |
| `in_transit` | In Transit | 运输中 |
| `arrived_lagos` | Arrived Lagos | 已抵达拉各斯 |
| `cleared_customs` | Cleared Customs | 已清关 |
| `received` | Received | 已签收 |
| `cancelled` | Cancelled | 已取消 |

---

## AI Prompt — generate a new locale file

Copy and paste the following prompt into any AI (Claude, ChatGPT, Gemini, etc.),
replacing `[LANGUAGE]` and `[CODE]` with the target language:

---

```
You are a professional translator for a B2B logistics management system.
Translate the following JSON file into [LANGUAGE] ([CODE]).

Rules:
1. Keep ALL JSON keys exactly as-is (do not translate the left side).
2. Translate ONLY the values (right side strings).
3. Preserve {{variable}} placeholders exactly — do not translate them.
4. Use formal/professional language appropriate for a business finance tool.
5. Keep labels concise — these appear in table headers and small buttons.
6. The application manages factory shipments from China to Nigeria and
   tracks payments in CNY (Chinese Yuan). Keep financial terminology accurate.
7. Return ONLY the JSON object, no explanations.

Source JSON (English):

{
  "currentBalance": "Current Balance",
  "alertThreshold": "Alert threshold",
  "reconcile": "Reconcile ({{count}})",
  "addEntry": "Add Entry",
  "balanceExceeded": "Balance has exceeded the alert threshold. Please arrange payment.",
  "date": "Date",
  "type": "Type",
  "description": "Description",
  "debit": "Debit",
  "credit": "Credit",
  "balance": "Balance",
  "reconCol": "Recon.",
  "noEntries": "No ledger entries yet",
  "noEntriesMsg": "Order charges and payments will appear here.",
  "failedToLoad": "Failed to load",
  "couldNotLoadEntries": "Could not load ledger entries.",
  "couldNotLoadShipments": "Could not load shipments.",
  "retry": "Retry",
  "addLedgerEntry": "Add Ledger Entry",
  "cancel": "Cancel",
  "saving": "Saving…",
  "saveEntry": "Save Entry",
  "entryType": "Entry Type",
  "amount": "Amount",
  "currency": "Currency",
  "fxRate": "FX Rate to CNY",
  "paymentMethod": "Payment Method",
  "selectPrompt": "— Select —",
  "paidBy": "Paid By",
  "paidByPlaceholder": "Person / entity name",
  "descriptionPlaceholder": "Short description (optional)",
  "all": "All",
  "newShipment": "New Shipment",
  "noShipments": "No shipments yet",
  "noShipmentsMsg": "When the factory dispatches goods, log the shipment here.",
  "items": "items",
  "shipped": "Shipped",
  "estimatedArrival": "Est. arrival",
  "courier": "Courier",
  "tracking": "Tracking",
  "shippingFee": "Shipping Fee",
  "itemsLabel": "Items",
  "advanceStatus": "Advance Status",
  "advanceTo": "Advance to",
  "updating": "Updating…",
  "confirm": "Confirm",
  "createShipment": "Create Shipment",
  "courierPlaceholder": "e.g. DHL, FedEx, Yanwen",
  "trackingNumber": "Tracking Number",
  "trackingPlaceholder": "Optional",
  "shippedDate": "Shipped Date",
  "unitPrice": "Unit Price ¥",
  "qty": "Qty",
  "add": "Add",
  "noFactoryAccounts": "No factory accounts",
  "noFactoryAccountsMsg": "No factory accounts have been set up yet.",
  "ledger": "Ledger",
  "shipmentsTab": "Shipments",
  "shipment": "Shipment",
  "langToggle": "[NATIVE LANGUAGE NAME, e.g. 한국어 for Korean]"
}
```

---

After you get the translated JSON back from the AI:
1. Save it as `apps/admin/src/i18n/locales/<code>.json`
2. Add `"<code>": "<native name>"` to `apps/admin/src/i18n/language-names.json`
3. Deploy — the language selector updates automatically.

For the status and entry-type labels, also update `constants.ts`:
- Add `labelKo` (or your language suffix) to each entry in `ENTRY_TYPE_META`
- Add `labelKo` to each entry in `SHIPMENT_STATUS_META` and `PAYMENT_METHOD_LABELS`
- Update the render logic: `isKo ? meta.labelKo : isZh ? meta.labelZh : meta.label`
