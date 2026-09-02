# Importing a physical stock count

How a counted-on-the-shelf spreadsheet becomes the system's on-hand figures —
without hand-editing a hundred products, and without going round the ledger.

Script: `scripts/import-stock-count.js` (`npm run stock:import-count -- …`).

---

## The one thing to understand first

**Goods Reception adds. A count adjustment replaces.**

Stock quantity in this system only ever moves through `stock_movements`. There
is no supported way to set an on-hand figure directly — `stock_levels` is
derived, and writing to it would desynchronise the movement log, the
reservations invariant and the GL.

So a recount is expressed as a **`count` stock adjustment**. Each line carries
two numbers:

| column           | meaning                          |
| ---------------- | -------------------------------- |
| `system_count`   | what the system believes today    |
| `physical_count` | what the counter actually found   |
| `delta`          | generated: `physical − system`    |

Posting the adjustment writes a movement of exactly `delta`. A base the system
thinks has 9 and the sheet says 2 gets a `-7` movement and lands on **2**. The
counted number *replaces* the system's — nothing is added on top.

Write-downs (physical < system) cannot be posted without approval
(`stock.service.js` → `postAdjustment`), which is what puts a recount in front
of the CEO before it changes anything.

---

## The sheet

One row per sellable combination, described on the four axes a base product is
keyed on. This is the shape the CEO already counts in:

| Color | Texture  | Cap Construction | Size | Units No. |
| ----- | -------- | ---------------- | ---- | --------- |
| black | Straight | HD13\*4          | M    | 20        |
| black | Straight | HD13\*4          | L    | 8         |
| GG4   | 4mm curl | HD13\*4          | M    | 1         |

- **No SKU or product code is needed** — someone counting a shelf does not have
  those. Rows are matched to base products on the four axes. When a sheet
  *does* carry a **Product Code** (every row of the downloadable template
  does), that code settles the match outright and the axes are ignored.
- **Header spellings are flexible**: `Color`/`Colour`, `Cap Construction`/`Lace`,
  `Units No.`/`Qty`/`Quantity`/`Count`.
- **Empty rows between colour blocks are fine** — they are dropped.
- A title row above the headers is fine; the first row with two or more filled
  cells is taken as the header.

### Spelling drift is absorbed, ambiguity is not

`HD13*4`, `HD13×4`, `hd 13 x 4` and `HD13X4` all normalise to the same key, as
do `XL` / `Xl` / `Extra Large`. But when a row matches **two** base products, or
**none**, the run stops and names the row. It never picks a winner — a silently
mis-landed row writes a wrong number into the ledger.

---

## The two decisions that change the outcome

### `--blank` — what an empty Units cell means

| value            | meaning                                                    |
| ---------------- | ---------------------------------------------------------- |
| `skip` (default) | not counted → leave the system's number alone               |
| `zero`           | counted, and there are none → write it down to nil          |

**Only `--blank=zero` makes the sheet a true SSOT.** With `skip`, a combination
the sheet lists but leaves empty keeps whatever the system already believed —
so the system ends up holding *more* than the sheet's total.

### `--unlisted` — base products the sheet never names

| value            | meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| `zero` (default) | the sheet is the whole truth → write them down to nil      |
| `skip`           | the count covered only part of the catalogue → leave alone |

Use `skip` when the count covered wigs but the brand also holds accessories,
bundles or anything else the counter did not walk past.

> **These two settings must agree.** `--blank=skip --unlisted=zero` is
> incoherent: a combination the CEO listed and left empty survives, while one
> she never mentioned is zeroed. Pick `zero`/`zero` for a full recount, or
> `skip`/`skip` for a partial one.

---

## Safety interlocks

All deliberate. Read why before removing one.

1. **Dry run by default.** Nothing is written without `--commit`.
2. **Unmatched rows abort the run.** Under `--unlisted=zero` an unmatched row
   never marks its product as counted, so it falls into the write-down-to-nil
   sweep — a half-matched sheet would quietly empty the shelf. Override with
   `--allow-unmatched` only after reading every reported line.
3. **A duplicated combination with two different numbers aborts.** A blank
   alongside a number resolves to the number; two different numbers cannot be
   resolved by a machine.
4. **Multi-location stock requires `--location`.** The sheet has no location
   column, so zeroing "everything not on the sheet" at a guessed location would
   wipe the other one.
5. **A base whose stock is spread across several variants is reported, not
   guessed.** The sheet counted the base, not its variants.
6. **The adjustment is submitted, never posted.** Stock does not move until an
   approver approves and posts it in Stock → Adjustments.

---

## Two ways to run it

Both paths go through the **same** reconciliation code
(`stock.count-sheet.js` + `stock.count-plan.js`), so they cannot disagree about
what a sheet means.

| | In the Hub | On the VPS |
| --- | --- | --- |
| Where | Stock → Adjustments → **Import Count** | `npm run stock:import-count` |
| Who | anyone with `stock:create` | ops, over SSH |
| Template | **Download** button in the modal | — |
| Preview | the review screen | dry run (the default) |
| Result | one submitted `count` adjustment | one submitted `count` adjustment |

---

## In the Hub (Stock → Adjustments → Import Count)

1. **Download the Excel template.** It comes pre-filled with one row per base
   product — Product Code, Product Name, and the four axes already written out
   — and an empty **Units No.** column. The counter walks the shelf and types
   numbers; nothing can come back unmatched, because every row *is* a real
   product.
2. **Upload the filled sheet.** The browser only reads the workbook; the
   matching and the reconciliation happen server-side.
3. **Review.** Every line shows `system → counted` with its delta, plus the
   unit total the location will hold once posted. Two toggles carry the
   judgement calls — what a blank cell means, and what happens to products the
   sheet never names — and the totals re-compute as you switch them.
4. **Submit for Approval.** One `count` adjustment is filed and submitted. The
   button stays disabled while anything is unresolved.
5. **Approve and post** on the Adjustments tab. *Only now does stock move.*

A sheet the CEO typed herself works too — the importer reads her column
headers directly. The template just removes the possibility of a typo landing
on nothing.

## On the VPS

```bash
# 1. Dry run — read the whole variance before anything is written
npm run stock:import-count -- --file count.xlsx --report variance.csv

# 2. A full SSOT replace (the sheet is everything we hold)
npm run stock:import-count -- --file count.xlsx --blank=zero --unlisted=zero

# 3. A partial count (wigs only; leave everything else alone)
npm run stock:import-count -- --file count.xlsx --blank=skip --unlisted=skip

# 4. File it for approval
npm run stock:import-count -- --file count.xlsx --blank=zero --commit
```

| flag                  | default       | purpose                                    |
| --------------------- | ------------- | ------------------------------------------ |
| `--file <path>`       | —             | `.xlsx` or `.csv` count sheet (required)   |
| `--brand <key>`       | `faitlynhair` | brand schema to count against              |
| `--sheet <name>`      | first sheet   | worksheet to read                          |
| `--location <id\|name>` | the stocked one | location the count covers                |
| `--blank skip\|zero`  | `skip`        | meaning of an empty Units cell             |
| `--unlisted zero\|skip` | `zero`      | products the sheet never names             |
| `--user <email>`      | the CEO       | who the adjustment is filed as             |
| `--report <path>`     | —             | full variance table as CSV                 |
| `--commit`            | off           | actually file the adjustment               |
| `--allow-unmatched`   | off           | proceed past blockers (dangerous)          |

The dry run prints every corrected line (`system → physical`), every product
about to be zeroed, and a summary that ends with the unit total the system will
hold once the adjustment is posted. **Check that total against the sheet's own
total before committing** — if the count is a full SSOT replace, they must be
equal.

### After committing

The script prints the adjustment number. Open **Stock → Adjustments**, review
the lines, then **approve and post**. Only then does stock move.

---

## The variance report

`--report variance.csv` writes one row per outcome, so the whole reconciliation
can be reviewed in Excel before anything is filed:

| outcome           | meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `corrected`       | counted, and different from the system                |
| `zeroed`          | not on the sheet, written down to nil                 |
| `already_correct` | counted, and the system already agreed (no line)      |
| `not_counted`     | blank Units cell under `--blank=skip` (left as-is)    |
| `unmatched`       | no base product, or more than one — needs a human     |
| `needs_attention` | matched, but its stock can't be pinned to one variant |

---

## When rows come back unmatched

The sheet names a combination the catalogue does not have, under that exact
name. Either:

- **The base product genuinely does not exist** — create it in Catalogue →
  Base Products, then re-run. This is the common case for a construction the
  lace ladder never seeded (`HD6*6`, and the `left part` / `center` variants).
- **It exists under a different name** — rename it so the four axes read
  cleanly (`{Colour} {Texture} {Lace} Pixie Wig - {Size}`), or fill in its
  `primary_colour` / `texture_type` / `lace_type` / `cap_size` columns, which
  the matcher also reads.
- **Two products answer to the same row** — the catalogue has duplicates.
  Merge or soft-delete one before importing.

---

## Code map

| file | role |
| --- | --- |
| `src/modules/stock/stock.count-sheet.js` | parsing, normalisation, catalogue matching |
| `src/modules/stock/stock.count-plan.js` | rows + shelf → adjustment lines + blockers |
| `stock.service.js` → `importCount` | preview / commit, shared by both entry points |
| `POST /stock/adjustments/import-count` | the endpoint the modal calls |
| `apps/admin/src/pages/stock/StockCountImportModal.tsx` | template, upload, review |
| `scripts/import-stock-count.js` | the CLI entry point |
| `scripts/lib/read-count-sheet.js` | `.xlsx`/`.csv` → header→cell rows (CLI only) |
| `tests/unit/stock/stock-count-sheet.test.js` | matching rules |
| `tests/unit/stock/stock-count-plan.test.js` | line building + interlocks |
| `tests/unit/stock/count-import-service.test.js` | preview vs commit, refusals |
