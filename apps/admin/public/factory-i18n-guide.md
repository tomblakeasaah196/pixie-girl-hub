# Factory Screens — i18n Translation Guide

**System**: Pixie Girl Hub admin app (`apps/admin`)  
**Scope**: Factory-facing screens — China Factory Account ledger, shipments, and Production runs  
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

All 174 keys that must appear in every locale file.
The table shows the key name, English text, Chinese text, and context notes.

| Key                      | English                                                           | Chinese (简体)                   | Context / Notes                                                     |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `currentBalance`         | Current Balance                                                   | 当前余额                         | Header above the main ¥ balance figure                              |
| `alertThreshold`         | Alert threshold                                                   | 预警阈值                         | Label next to the configured alert limit                            |
| `reconcile`              | Reconcile ({{count}})                                             | 对账 ({{count}})                 | Button — {{count}} = number of rows selected; keep the placeholder  |
| `addEntry`               | Add Entry                                                         | 添加记录                         | Primary button to open the Add Ledger Entry drawer                  |
| `balanceExceeded`        | Balance has exceeded the alert threshold. Please arrange payment. | 余额已超过预警阈值，请及时付款。 | Warning banner shown when balance ≥ alert threshold                 |
| `date`                   | Date                                                              | 日期                             | Table column header — transaction date                              |
| `type`                   | Type                                                              | 类型                             | Table column header — entry type (payment, charge, etc.)            |
| `description`            | Description                                                       | 描述                             | Table column header and form field label                            |
| `debit`                  | Debit                                                             | 借方                             | Table column header; also used as a direction toggle button         |
| `credit`                 | Credit                                                            | 贷方                             | Table column header; also used as a direction toggle button         |
| `balance`                | Balance                                                           | 余额                             | Table column header — running balance                               |
| `reconCol`               | Recon.                                                            | 对账                             | Table column header — reconciliation tick mark column (short label) |
| `noEntries`              | No ledger entries yet                                             | 暂无记录                         | Empty state title when the ledger has no rows                       |
| `noEntriesMsg`           | Order charges and payments will appear here.                      | 订单收费和付款将显示在这里。     | Empty state subtitle                                                |
| `failedToLoad`           | Failed to load                                                    | 加载失败                         | Error state title (used for both ledger and shipments)              |
| `couldNotLoadEntries`    | Could not load ledger entries.                                    | 无法加载账户记录。               | Error state message for the ledger table                            |
| `couldNotLoadShipments`  | Could not load shipments.                                         | 无法加载发货记录。               | Error state message for the shipments panel                         |
| `retry`                  | Retry                                                             | 重试                             | Button in error states                                              |
| `addLedgerEntry`         | Add Ledger Entry                                                  | 添加账户记录                     | Drawer title — opens the form to add a new ledger row               |
| `cancel`                 | Cancel                                                            | 取消                             | Secondary / ghost button in drawers                                 |
| `saving`                 | Saving…                                                           | 保存中…                          | Spinner label while an API mutation is in flight                    |
| `saveEntry`              | Save Entry                                                        | 保存                             | Primary button in the Add Ledger Entry drawer                       |
| `entryType`              | Entry Type                                                        | 类型                             | Field label in Add Ledger Entry form                                |
| `amount`                 | Amount                                                            | 金额                             | Field label — monetary amount                                       |
| `currency`               | Currency                                                          | 货币                             | Field label — currency selector (CNY / NGN / USD)                   |
| `fxRate`                 | FX Rate to CNY                                                    | 汇率（转换为CNY）                | Field label — exchange rate from original currency to Chinese Yuan  |
| `paymentMethod`          | Payment Method                                                    | 付款方式                         | Field label — how the payment was made                              |
| `selectPrompt`           | — Select —                                                        | — 选择 —                         | Placeholder option in select dropdowns (the "no selection" item)    |
| `paidBy`                 | Paid By                                                           | 付款人                           | Field label — name of person or entity who made the payment         |
| `paidByPlaceholder`      | Person / entity name                                              | 付款人姓名                       | Input placeholder for the Paid By field                             |
| `descriptionPlaceholder` | Short description (optional)                                      | 备注（选填）                     | Input placeholder for the Description field                         |
| `all`                    | All                                                               | 全部                             | Filter chip — shows all shipment statuses                           |
| `newShipment`            | New Shipment                                                      | 新建发货单                       | Button to open the Create Shipment drawer                           |
| `noShipments`            | No shipments yet                                                  | 暂无发货记录                     | Empty state title when no shipments have been logged                |
| `noShipmentsMsg`         | When the factory dispatches goods, log the shipment here.         | 工厂发货后，记录在这里。         | Empty state subtitle for shipments                                  |
| `items`                  | items                                                             | 件                               | Suffix after item count on shipment cards, e.g. "3 items" / "3件"   |
| `shipped`                | Shipped                                                           | 发货                             | Label for the shipment dispatch date                                |
| `estimatedArrival`       | Est. arrival                                                      | 预计到达                         | Label for the expected arrival date                                 |
| `courier`                | Courier                                                           | 快递公司                         | Field label — courier/logistics company name                        |
| `tracking`               | Tracking                                                          | 追踪号                           | Label for tracking number in shipment detail drawer                 |
| `shippingFee`            | Shipping Fee                                                      | 运费                             | Field label — cost of shipping/freight                              |
| `itemsLabel`             | Items                                                             | 货物明细                         | Section heading for the list of goods inside a shipment             |
| `advanceStatus`          | Advance Status                                                    | 更新状态                         | Button to open the status-advance panel inside a shipment drawer    |
| `advanceTo`              | Advance to                                                        | 更新为                           | Label above the status selection buttons when advancing             |
| `updating`               | Updating…                                                         | 更新中…                          | Spinner label while the status change is being saved                |
| `confirm`                | Confirm                                                           | 确认                             | Button to confirm the status advance                                |
| `createShipment`         | Create Shipment                                                   | 创建发货单                       | Primary button in the Create Shipment drawer                        |
| `courierPlaceholder`     | e.g. DHL, FedEx, Yanwen                                           | 如：DHL、FedEx                   | Placeholder for the Courier input field                             |
| `trackingNumber`         | Tracking Number                                                   | 追踪号                           | Field label for tracking number in the Create Shipment form         |
| `trackingPlaceholder`    | Optional                                                          | 追踪号（选填）                   | Placeholder for the Tracking Number field                           |
| `shippedDate`            | Shipped Date                                                      | 发货日期                         | Field label for the date goods were dispatched                      |
| `unitPrice`              | Unit Price ¥                                                      | 单价(CNY)                        | Field label — per-unit price in Chinese Yuan                        |
| `qty`                    | Qty                                                               | 数量                             | Field label — quantity of units                                     |
| `add`                    | Add                                                               | 添加                             | Small button to add another item row in the shipment form           |
| `noFactoryAccounts`      | No factory accounts                                               | 暂无工厂账户                     | Empty state title when no factory accounts exist                    |
| `noFactoryAccountsMsg`   | No factory accounts have been set up yet.                         | 尚未设置工厂账户。               | Empty state subtitle                                                |
| `ledger`                 | Ledger                                                            | 账户记录                         | Sub-tab label — shows the account ledger                            |
| `shipmentsTab`           | Shipments                                                         | 发货记录                         | Sub-tab label — shows the shipments list                            |
| `shipment`               | Shipment                                                          | 发货单                           | Title in the shipment detail drawer when the ref hasn't loaded yet  |
| `langToggle`             | EN                                                                | 中文                             | Language label shown on the selector when this language is active   |

> **Note**: Entry type labels (`payment`, `charge`, `credit_note`, etc.) and
> shipment status labels (`dispatched`, `in_transit`, `received`, etc.) are
> defined in `apps/admin/src/pages/production/constants.ts` under the
> `ENTRY_TYPE_META` and `SHIPMENT_STATUS_META` objects. Each entry has a
> `label` (English) and `labelZh` (Chinese) property. When adding a new
> language, also update those constant objects.


### Production run screens

Added when the Production module became fully operable by the China factory
manager (open a run, add products, record what the factory charged, advance
status). Grouped keys such as `runStatus.planned` are LITERAL key names, not
nested objects — the bundle stays a flat map of string → string.

| Key | English | Chinese (简体) | Context / Notes |
| --- | --- | --- | --- |
| `productionTitle` | Production | 生产 | Production run screens |
| `productionSubtitle` | China factory account · shipments · production runs | 中国工厂账户 · 货运 · 生产批次 | Production run screens |
| `overviewTab` | Overview | 总览 | Production run screens |
| `factoryAccountTab` | Factory Account | 工厂账户 | Production run screens |
| `productionRunsTab` | Production Runs | 生产批次 | Production run screens |
| `accessRestricted` | Access restricted | 访问受限 | Production run screens |
| `accessRestrictedMsg` | You don't have permission to view Production & Factory accounts. | 您没有查看生产与工厂账户的权限。 | Production run screens |
| `active` | Active | 启用 | Production run screens |
| `inactive` | Inactive | 停用 | Production run screens |
| `factoryAccountsHeading` | Factory Accounts | 工厂账户 | Production run screens |
| `kpiActiveAccounts` | Active Factory Accounts | 启用的工厂账户 | Production run screens |
| `kpiTotalBalance` | Total Balance ({{currency}}) | 总余额（{{currency}}） | Production run screens — keep the {{placeholders}} exactly |
| `kpiShipmentsInTransit` | Shipments in Transit | 运输中的货运 | Production run screens |
| `kpiRunsInProduction` | Runs in Production | 生产中的批次 | Production run screens |
| `runNumber` | Run # | 批次号 | Production run screens |
| `title` | Title | 名称 | Production run screens |
| `units` | Units | 数量 | Production run screens |
| `totalCost` | Total Cost | 总成本 | Production run screens |
| `perUnitCost` | Per Unit Cost | 单位成本 | Production run screens |
| `created` | Created | 创建时间 | Production run screens |
| `noRuns` | No production runs | 暂无生产批次 | Production run screens |
| `noRunsMsg` | Track a production batch from the factory through to the Lagos warehouse. | 跟踪生产批次，从工厂一直到拉各斯仓库。 | Production run screens |
| `newRun` | New Run | 新建批次 | Production run screens |
| `newProductionRun` | New Production Run | 新建生产批次 | Production run screens |
| `couldNotLoadRuns` | Could not load production runs. | 无法加载生产批次。 | Production run screens |
| `stepOf` | Step {{step}} of {{total}} | 第 {{step}} 步，共 {{total}} 步 | Production run screens — keep the {{placeholders}} exactly |
| `back` | Back | 上一步 | Production run screens |
| `next` | Next | 下一步 | Production run screens |
| `creating` | Creating… | 创建中… | Production run screens |
| `createRun` | Create Run | 创建批次 | Production run screens |
| `runTitle` | Run Title | 批次名称 | Production run screens |
| `runTitlePlaceholder` | e.g. 13×6 Lace Front — June Batch | 例如：13×6 蕾丝前额 — 六月批次 | Production run screens |
| `factoryCurrency` | Factory Currency | 工厂结算货币 | Production run screens |
| `factoryCurrencyHint` | The currency the factory invoices you in. | 工厂向您开票所使用的货币。 | Production run screens |
| `fromPo` | From Purchase Order | 来自采购订单 | Production run screens |
| `fromPoHint` | Optional — pulls that order's lines onto this run. | 可选 — 将该订单的明细导入本批次。 | Production run screens |
| `noPo` | No purchase order | 不关联采购订单 | Production run screens |
| `expectedArrival` | Expected Arrival | 预计到货日期 | Production run screens |
| `notes` | Notes | 备注 | Production run screens |
| `notesPlaceholder` | Anything the Lagos team should know | 拉各斯团队需要了解的信息 | Production run screens |
| `poLinesHint` | The purchase order's lines are added automatically. Add extra products below if you need to. | 采购订单的明细将自动导入。如有需要，可在下方添加其他产品。 | Production run screens |
| `unitsPlanned` | Units Planned | 计划数量 | Production run screens |
| `factoryCharge` | Factory Charge | 工厂费用 | Production run screens |
| `otherCostsHint` | Freight, customs, 3PL and packaging are added to the run after it is created. | 运费、关税、拉各斯第三方物流和包装费用在批次创建后再添加。 | Production run screens |
| `lineCount` | {{n}} product line(s) | {{n}} 条产品明细 | Production run screens — keep the {{placeholders}} exactly |
| `bulkAdd` | Bulk Add | 批量添加 | Production run screens |
| `addLine` | Add Line | 添加明细 | Production run screens |
| `bulkAddHint` | Pick a product type, search, and tick everything you are making — each one becomes its own line. | 选择产品类型，搜索并勾选所有要生产的产品 — 每个产品会生成一条明细。 | Production run screens |
| `lineN` | Line {{n}} | 第 {{n}} 条 | Production run screens — keep the {{placeholders}} exactly |
| `removeLine` | Remove line | 删除明细 | Production run screens |
| `product` | Product | 产品 | Production run screens |
| `change` | Change | 更换 | Production run screens |
| `quantity` | Quantity | 数量 | Production run screens |
| `unitCostIn` | Unit cost ({{currency}}) | 单价（{{currency}}） | Production run screens — keep the {{placeholders}} exactly |
| `lineTotal` | Line total | 小计 | Production run screens |
| `fxLoading` | Loading rate… | 正在获取汇率… | Production run screens |
| `fxMissing` | No exchange rate is configured for {{currency}} — enter the rate you converted at. | 未配置 {{currency}} 的汇率 — 请填写您实际换汇的汇率。 | Production run screens — keep the {{placeholders}} exactly |
| `fxPreview` | At {{rate}} | 按汇率 {{rate}} | Production run screens — keep the {{placeholders}} exactly |
| `fxRateHint` | Leave blank to use the system rate. Enter a rate only if you converted at a different one. | 留空则使用系统汇率。仅在实际换汇汇率不同时才需填写。 | Production run screens |
| `fxNoRate` | No system rate | 无系统汇率 | Production run screens |
| `addCost` | Add Cost | 添加成本 | Production run screens |
| `costTypeLabel` | Cost Type | 成本类型 | Production run screens |
| `invoiceReference` | Invoice Reference | 发票号 | Production run screens |
| `invoiceReferencePlaceholder` | Supplier invoice number | 供应商发票号 | Production run screens |
| `costDescriptionPlaceholder` | What this cost covers | 该笔成本的说明 | Production run screens |
| `incurredAt` | Date Incurred | 发生日期 | Production run screens |
| `addProducts` | Add Products | 添加产品 | Production run screens |
| `productsInRun` | Products in this run | 本批次产品 | Production run screens |
| `unnamedProduct` | Unnamed product | 未命名产品 | Production run screens |
| `unitsReceivedOf` | {{received}}/{{planned}} units received | 已收货 {{received}}/{{planned}} 件 | Production run screens — keep the {{placeholders}} exactly |
| `costComponents` | Cost Components | 成本明细 | Production run screens |
| `costHiddenForRole` | Naira cost is not shown for your role. | 您的角色无法查看奈拉成本。 | Production run screens |
| `receiveUnits` | Receive Units | 接收入库 | Production run screens |
| `receiveHint` | {{n}} unit(s) still outstanding on this run. | 本批次还有 {{n}} 件待收货。 | Production run screens — keep the {{placeholders}} exactly |
| `receiveNoProducts` | This run has no products linked to the catalogue, so nothing can be received into stock. Add products first. | 本批次没有关联产品目录，无法入库。请先添加产品。 | Production run screens |
| `location` | Location | 仓库位置 | Production run screens |
| `receiveQtyHint` | How many finished units arrived. | 本次到货的成品数量。 | Production run screens |
| `receiveAtCost` | Booked in at | 入库成本 | Production run screens |
| `runStatus.planned` | Planned | 已计划 | Production run status pill (state machine label) |
| `runStatus.funded` | Funded | 已付款 | Production run status pill (state machine label) |
| `runStatus.in_production` | In Production | 生产中 | Production run status pill (state machine label) |
| `runStatus.quality_check` | Quality Check | 质检中 | Production run status pill (state machine label) |
| `runStatus.ready_to_ship` | Ready to Ship | 待发货 | Production run status pill (state machine label) |
| `runStatus.in_transit` | In Transit | 运输中 | Production run status pill (state machine label) |
| `runStatus.arrived_lagos` | Arrived Lagos | 已到拉各斯 | Production run status pill (state machine label) |
| `runStatus.cleared_customs` | Cleared Customs | 清关完成 | Production run status pill (state machine label) |
| `runStatus.received` | Received | 已收货 | Production run status pill (state machine label) |
| `runStatus.completed` | Completed | 已完成 | Production run status pill (state machine label) |
| `runStatus.cancelled` | Cancelled | 已取消 | Production run status pill (state machine label) |
| `unitStatus.planned` | Planned | 已计划 | Per-unit status pill inside a run |
| `unitStatus.in_production` | In Production | 生产中 | Per-unit status pill inside a run |
| `unitStatus.qc_pass` | QC Passed | 质检合格 | Per-unit status pill inside a run |
| `unitStatus.qc_fail` | QC Failed | 质检不合格 | Per-unit status pill inside a run |
| `unitStatus.in_transit` | In Transit | 运输中 | Per-unit status pill inside a run |
| `unitStatus.arrived` | Arrived | 已到达 | Per-unit status pill inside a run |
| `unitStatus.styled` | Styled | 已造型 | Per-unit status pill inside a run |
| `unitStatus.received` | Received | 已收货 | Per-unit status pill inside a run |
| `unitStatus.rejected` | Rejected | 已拒收 | Per-unit status pill inside a run |
| `unitStatus.reworked` | Reworked | 已返工 | Per-unit status pill inside a run |
| `costType.factory_unit_cost` | Factory Unit Cost | 工厂单价成本 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.factory_overhead` | Factory Overhead | 工厂管理费 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.raw_hair` | Raw Hair | 原料头发 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.quality_inspection` | Quality Inspection | 质量检验费 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.freight_international` | International Freight | 国际运费 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.customs_duty` | Customs Duty | 关税 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.customs_clearing_fee` | Customs Clearing Fee | 清关费 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.port_storage` | Port Storage / Demurrage | 港口仓储费 / 滞期费 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.3pl_lagos` | 3PL Lagos | 拉各斯第三方物流 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.styling_intercompany` | Styling (Intercompany) | 造型费（关联公司） | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.packaging` | Packaging | 包装费 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.wastage` | Wastage | 损耗 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.samples` | Samples | 样品 | Cost component type — appears in the Add Cost picker and the cost list |
| `costType.misc` | Miscellaneous | 其他费用 | Cost component type — appears in the Add Cost picker and the cost list |
---

## Entry Type labels (from constants.ts)

These live in `constants.ts` and must be updated there, not in the JSON:

| `entry_type` key | English     | Chinese   |
| ---------------- | ----------- | --------- |
| `payment`        | Payment     | 付款      |
| `charge`         | Charge      | 收费      |
| `credit_note`    | Credit Note | 退款/抵扣 |
| `advance`        | Advance     | 预付款    |
| `adjustment`     | Adjustment  | 调整      |

## Shipment Status labels (from constants.ts)

| `status` key      | English         | Chinese      |
| ----------------- | --------------- | ------------ |
| `dispatched`      | Dispatched      | 已发货       |
| `in_transit`      | In Transit      | 运输中       |
| `arrived_lagos`   | Arrived Lagos   | 已抵达拉各斯 |
| `cleared_customs` | Cleared Customs | 已清关       |
| `received`        | Received        | 已签收       |
| `cancelled`       | Cancelled       | 已取消       |

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
