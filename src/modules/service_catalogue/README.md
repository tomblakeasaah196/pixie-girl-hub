# Service Catalogue

The companion to the product catalogue — wig revamps, custom styles,
repairs, install, lace tinting, closure repair, etc.

**Spec:** Pixie Girl Hub V2.2 §6.17 (Smartcomm "Convert to ...") +
§6.4 (Catalogue tab)
**Permission key:** `service_catalogue`

## Why it exists

A customer DMing "can you revamp this wig?" or "I want this style" gets
turned into either a Service Job (Faitlyn revamp) or a Custom Order
(new style) in one tap. The list of services is data-driven so adding
"Closure repair" tomorrow doesn't need a code change — a new row here
shows up automatically in:

  - The Smartcomm composer's "Convert to ..." menu.
  - The Catalogue → Services tab in the admin app.
  - The public order form's services picker.

## Backing tables

- `shared.service_offerings`

## Files

| File                                | Purpose                                  |
| ----------------------------------- | ---------------------------------------- |
| `service-catalogue.routes.js`       | Express router                           |
| `service-catalogue.controller.js`   | HTTP handlers                            |
| `service-catalogue.service.js`      | Business logic + audit                   |
| `service-catalogue.repo.js`         | Parameterised SQL                        |
| `service-catalogue.validator.js`    | Zod input schemas                        |
