# CashRequest module

**Spec:** Cash Request & Disbursement (V2.2 §6.32 — NEW MODULE — pending schema)
**Permission key:** `cash_request` (split out of `expenses` so the disbursement
queue can be granted independently of the expense ledger)

## Backing tables

- `cash_requests (PENDING)`
- `cash_request_state_history (PENDING)`

## Files

| File                         | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `cash-request.routes.js`     | Express router — URL → controller    |
| `cash-request.controller.js` | HTTP handlers (req/res only)         |
| `cash-request.service.js`    | Business logic, transactions, events |
| `cash-request.repo.js`       | Parameterised SQL only               |
| `cash-request.validator.js`  | Zod input schemas                    |
| `cash-request.events.js`     | Domain events for realtime + AI      |

## TODOs

- [ ] Implement repo create/update with real columns
- [ ] Implement validator schemas with actual field definitions
- [ ] Add module-specific endpoints to routes (state transitions, sub-resources)
- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add unit tests in `tests/unit/cash_request/`
- [ ] Add integration tests in `tests/integration/cash_request/`
