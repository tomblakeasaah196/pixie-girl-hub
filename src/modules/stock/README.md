# Stock module

**Spec:** Stock SSOT (V2.2 §6.9)
**Permission key:** `stock`

## Backing tables

- `stock_locations`
- `stock_movements`
- `stock_levels`
- `stock_alerts`
- `stock_adjustments`
- `stock_transfers`
- `inbound_shipments`

## Files

| File                  | Purpose                              |
| --------------------- | ------------------------------------ |
| `stock.routes.js`     | Express router — URL → controller    |
| `stock.controller.js` | HTTP handlers (req/res only)         |
| `stock.service.js`    | Business logic, transactions, events |
| `stock.repo.js`       | Parameterised SQL only               |
| `stock.validator.js`  | Zod input schemas                    |
| `stock.events.js`     | Domain events for realtime + AI      |

## Bulk stock count

A physical recount is imported from a spreadsheet — in the Hub via Stock →
Adjustments → **Import Count** (`POST /stock/adjustments/import-count`), or
headless via `npm run stock:import-count`. Both file ONE `count` adjustment
whose lines carry `system_count` vs `physical_count`, submitted for approval —
stock only moves when an approver posts it. See `docs/STOCK_COUNT_IMPORT.md`.

The matching and reconciliation rules live in `stock.count-sheet.js` (sheet row
→ base product) and `stock.count-plan.js` (rows + shelf → lines + the reasons
to refuse), so the endpoint and the CLI can't drift apart. `commit: false`
previews without writing; the endpoint reports its blockers rather than
throwing, so the review screen can show them before anyone commits.

Note the difference from Goods Reception, which is the other bulk path:
reception **adds** units, a count adjustment **replaces** them (posting writes a
movement of `physical − system`, so the counted number becomes the on-hand).

## TODOs

- [ ] Implement repo create/update with real columns
- [ ] Implement validator schemas with actual field definitions
- [ ] Add module-specific endpoints to routes (state transitions, sub-resources)
- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add unit tests in `tests/unit/stock/`
- [ ] Add integration tests in `tests/integration/stock/`
