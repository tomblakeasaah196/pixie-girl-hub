# Outbound Channel Policy

CEO-editable matrix that decides which channel every automated
outbound notification uses. Source of truth for cost discipline.

**Spec:** Pixie Girl Hub V2.2 §6.17 + the cost-strategy decision in
PR 2.
**Permission key:** `outbound_policy`

## Why it exists

Without this table, every automation in the system would either
hard-code a channel ("send WhatsApp tracking") or guess. Both lead to
unpredictable Meta bills the CEO can't see coming.

The policy answers a single question for every outbound emit:
"for event X on brand Y, who pays and where does it go?"

## Backing table

- `shared.outbound_channel_policy` — one row per `(business, event_key)`

## The resolveChannel decision tree

```
respect contact.preferred_channel = 'none' ?  → disabled
policy.is_active = false ?                    → disabled
policy = 'respect_contact_pref' AND contact has preference ?
                                              → use contact preference
                                              → otherwise fallback_channel
chosen = whatsapp AND policy.block_whatsapp ? → fallback_channel (or email)
otherwise                                     → policy.channel_preference
```

## Files

| File                            | Purpose                                     |
| ------------------------------- | ------------------------------------------- |
| `outbound-policy.routes.js`     | Express router                              |
| `outbound-policy.controller.js` | HTTP handlers                               |
| `outbound-policy.service.js`    | Business logic + audit                      |
| `outbound-policy.repo.js`       | Parameterised SQL + `resolveChannel` helper |
| `outbound-policy.validator.js`  | Zod input schemas                           |

## Endpoints

| Method | Path                                                     |
| ------ | -------------------------------------------------------- |
| GET    | `/api/v1/outbound-policy`                                |
| GET    | `/api/v1/outbound-policy/resolve?event_key=&contact_id=` |
| GET    | `/api/v1/outbound-policy/:event_key`                     |
| PUT    | `/api/v1/outbound-policy`                                |
