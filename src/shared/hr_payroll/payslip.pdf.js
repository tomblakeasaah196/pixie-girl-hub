/**
 * Payslip → PDF (V2.2 §6.11).
 *
 * A full-page, brand-skinned A4 payslip built on the SAME document canon as the
 * invoice/receipt renderer (services/pdf.brand-docs): Playfair Display for the
 * name and figures, Montserrat for body copy, JetBrains Mono for money, the
 * brand accent from business_config, and a full-bleed 210×297mm sheet drawn by
 * the renderer itself (so the PDF engine must apply ZERO page margins — pass
 * brandDocs.PDF_OPTIONS).
 *
 * The document is a real statement of pay, not a summary: employer identity,
 * employee identity, the pay period and run it came from, an itemised earnings
 * ledger beside an itemised deductions ledger, the net-pay figure spelled out
 * in words, attendance/pro-rata, employer contributions (which are a company
 * cost, NOT withheld from net), and how the money was actually paid.
 *
 * Pure HTML generation — no I/O — so it unit-tests without a browser.
 */

"use strict";

const { tint, shade } = require("../../services/pdf.brand-docs");
const { formatDate } = require("../../utils/dates");

// ── primitives ──────────────────────────────────────────────────
const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const present = (v) => v !== null && v !== undefined && v !== "";
const num = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const ngn = (v) =>
  "₦" +
  num(v).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const day = (v) => (present(v) ? formatDate(v) : null);
const titleise = (s) =>
  String(s || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ── net pay in words ────────────────────────────────────────────
// Nigerian payroll convention: the net figure is also spelled out, so a
// tampered numeral is obvious. "…naira only" when there are no kobo.
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety",
];
const SCALES = [
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];

/** 1–999 → words ("two hundred and fifty"). */
function underThousand(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t}-${ONES[r]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  const r = n % 100;
  return r ? `${h} and ${underThousand(r)}` : h;
}

/** Whole number → words. Scale groups are comma-separated. */
function intToWords(n) {
  if (n === 0) return "zero";
  const parts = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${intToWords(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (!rest) return parts.join(", ");
  if (!parts.length) return underThousand(rest);
  // As spoken: "and" before a final group under a hundred ("one thousand and
  // fifty"), a comma before a larger one ("one thousand, two hundred and fifty").
  return rest < 100
    ? `${parts.join(", ")} and ${underThousand(rest)}`
    : `${parts.join(", ")}, ${underThousand(rest)}`;
}

/** Money → "Two hundred and fifty thousand naira only" (sentence case). */
function nairaInWords(value) {
  const total = Math.round(num(value) * 100);
  const negative = total < 0;
  const abs = Math.abs(total);
  const naira = Math.floor(abs / 100);
  const kobo = abs % 100;
  let words = `${intToWords(naira)} naira`;
  if (kobo > 0) words += `, ${intToWords(kobo)} kobo`;
  words += " only";
  if (negative) words = `minus ${words}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── line classification ─────────────────────────────────────────
// payslip_lines.line_type is a closed CHECK list; split it into the three
// ledgers a payslip shows. Employer contributions are a COMPANY cost — they
// must never land in the deductions column that reduces net pay.
const EARNING_TYPES = new Set([
  "base_salary",
  "housing_allowance",
  "transport_allowance",
  "commission",
  "bonus",
  "overtime",
  "reimbursement",
  "other_earning",
]);
const EMPLOYER_TYPES = new Set(["pension_employer", "nsitf"]);

/**
 * Group the itemised lines into { earnings, deductions, employer }. Anything
 * outside the earning/employer sets is a deduction — so a line_type added to
 * the schema later still shows up somewhere rather than vanishing.
 */
function groupLines(lines) {
  const out = { earnings: [], deductions: [], employer: [] };
  for (const l of lines || []) {
    const row = {
      label: l.description || titleise(l.line_type),
      amount: num(l.amount_ngn ?? l.amount),
    };
    if (EARNING_TYPES.has(l.line_type)) out.earnings.push(row);
    else if (EMPLOYER_TYPES.has(l.line_type)) out.employer.push(row);
    else out.deductions.push(row);
  }
  return out;
}

/** Ledgers rebuilt from the payslip's own columns — used when a slip carries
 *  no itemised lines (legacy rows), so the document is never blank. */
function ledgersFromColumns(p) {
  const pick = (pairs) =>
    pairs
      .filter(([, v]) => num(v) > 0)
      .map(([label, v]) => ({ label, amount: num(v) }));
  return {
    earnings: pick([
      ["Basic salary", p.base_salary_ngn],
      ["Allowances", p.allowances_ngn],
      ["Commission", p.commission_ngn],
      ["Bonus", p.bonus_ngn],
      ["Overtime", p.overtime_ngn],
      ["Reimbursements", p.reimbursements_ngn],
    ]),
    deductions: pick([
      ["PAYE", p.paye_ngn],
      ["Pension (employee)", p.pension_employee_ngn],
      ["NHF", p.nhf_ngn],
      ["Attendance deductions", p.attendance_deduction_ngn],
      ["Loan repayment", p.loan_repayment_ngn],
      ["Cash advance recovery", p.advance_recovery_ngn],
      ["Other deductions", p.other_deductions_ngn],
    ]),
    employer: pick([["Pension (employer)", p.pension_employer_ngn]]),
  };
}

/**
 * Keep a ledger honest against the stored total. The persisted total is the
 * figure net pay was actually computed from, so it always wins; if the itemised
 * rows don't reach it, the difference is shown as its own row rather than
 * leaving a column that visibly doesn't add up.
 */
function reconcile(rows, storedTotal, balancingLabel) {
  const total = num(storedTotal);
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  const diff = Math.round((total - sum) * 100) / 100;
  if (Math.abs(diff) >= 0.01) rows = [...rows, { label: balancingLabel, amount: diff }];
  return { rows, total };
}

/** Show only the last 4 of the disbursement account. */
function maskAccount(acct) {
  const digits = String(acct || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length <= 4 ? `••••${digits}` : `••••${digits.slice(-4)}`;
}

const STATUS_TONE = {
  paid: "#1E7A4D",
  queued: "#8A6A11",
  pending: "#7C736B",
  failed: "#A5231F",
  reversed: "#7C736B",
};

// ── building blocks ─────────────────────────────────────────────
function identityRows(pairs) {
  return pairs
    .filter(([, v]) => present(v))
    .map(
      ([k, v]) =>
        `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`,
    )
    .join("");
}

function ledger({ title, rows, total, totalLabel, accent, negative }) {
  const body = rows.length
    ? rows
        .map(
          (r, i) => `<tr${i % 2 ? ' class="zebra"' : ""}>
            <td class="l-desc">${esc(r.label)}</td>
            <td class="l-num">${esc((negative && r.amount > 0 ? "−" : "") + ngn(Math.abs(r.amount)))}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="l-empty">None this period</td></tr>`;
  return `<table class="ledger">
    <thead><tr><th>${esc(title)}</th><th class="r">Amount</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td class="l-tot" style="color:${accent}">${esc(totalLabel)}</td>
      <td class="l-tot l-num" style="color:${accent}">${esc((negative ? "−" : "") + ngn(Math.abs(total)))}</td>
    </tr></tfoot>
  </table>`;
}

/** Brand mark — the configured logo, else a monogram tile (matches invoices). */
function brandMark(brand) {
  if (brand.logo_url) {
    return `<img src="${esc(brand.logo_url)}" alt="${esc(brand.brand_name)}" style="height:46px;width:auto;display:block" />`;
  }
  const initials = String(brand.brand_name || "Brand")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `<div class="monogram" style="background:${brand.accent}">${esc(initials)}</div>`;
}

/**
 * @param {object} brand  identity from pdf.brand-docs.brandFromTokens(), plus
 *                        optional { tin, cac_number }
 * @param {object} slip   the enriched payslip row (payroll.repo.findPayslip):
 *                        columns + `lines` + staff/run context
 */
function payslipHtml(brand, slip) {
  const p = slip || {};
  const accent = brand.accent || "#690909";
  const accentDeep = brand.accent_deep || shade(accent, 0.28);
  const hairline = "#E7E1DA";
  const ink = "#1B1714";
  const muted = "#7C736B";

  const lines = Array.isArray(p.lines) ? p.lines : [];
  const grouped = lines.length ? groupLines(lines) : ledgersFromColumns(p);
  const earnings = reconcile(grouped.earnings, p.gross_pay_ngn, "Other earnings");
  const deductions = reconcile(
    grouped.deductions,
    p.total_deductions_ngn,
    "Other deductions",
  );
  const employer = grouped.employer.length
    ? grouped.employer
    : num(p.pension_employer_ngn) > 0
      ? [{ label: "Pension (employer)", amount: num(p.pension_employer_ngn) }]
      : [];

  const status = String(p.payment_status || "pending");
  const statusTone = STATUS_TONE[status] || muted;

  const periodLabel =
    day(p.period_start) && day(p.period_end)
      ? `${day(p.period_start)} — ${day(p.period_end)}`
      : day(p.period_start) || day(p.period_end) || null;

  const attendance =
    present(p.days_worked) && present(p.working_days_in_period)
      ? `${Number(p.days_worked)} of ${Number(p.working_days_in_period)} working days`
      : null;
  const prorate =
    present(p.prorate_factor) && Number(p.prorate_factor) < 1
      ? `Pro-rated ×${Number(p.prorate_factor).toFixed(4)}`
      : null;

  const employeeRows = identityRows([
    ["Employee no.", p.employee_number],
    ["Job title", p.job_title_snapshot || p.staff_job_title],
    ["Department", p.department_snapshot || p.staff_department],
    ["Employment type", p.employment_type && titleise(p.employment_type)],
    ["Date joined", day(p.staff_start_date)],
  ]);

  const periodRows = identityRows([
    ["Pay date", day(p.pay_date)],
    ["Payroll run", p.run_number],
    ["Payslip no.", p.payslip_number],
    ["Days worked", attendance],
    ["Pro-rata", prorate],
  ]);

  const paymentRows = identityRows([
    ["Status", titleise(status)],
    ["Method", p.payment_method && titleise(p.payment_method)],
    ["Bank", p.bank_name],
    ["Account", maskAccount(p.bank_account_snapshot)],
    ["Reference", p.payment_reference],
    ["Paid on", day(p.paid_at)],
    ["Reason", status === "failed" ? p.failure_reason : null],
  ]);

  const employerBlock = employer.length
    ? `<div class="panel">
        <div class="eyebrow" style="color:${accent}">Employer contributions</div>
        <table class="kv">
          ${employer
            .map(
              (r) =>
                `<tr><td class="k">${esc(r.label)}</td><td class="v mono">${esc(ngn(r.amount))}</td></tr>`,
            )
            .join("")}
        </table>
        <div class="panel-note">Paid by ${esc(brand.brand_name || "the company")} on your behalf — not deducted from your net pay.</div>
      </div>`
    : "";

  const footerId = [
    esc(brand.brand_legal_name || brand.brand_name || ""),
    brand.cac_number && `CAC ${esc(brand.cac_number)}`,
    brand.tin && `TIN ${esc(brand.tin)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const contactLine = [
    brand.brand_address && esc(brand.brand_address),
    brand.brand_phone && esc(brand.brand_phone),
    brand.support_email && esc(brand.support_email),
  ]
    .filter(Boolean)
    .join(" · ");

  // No @font-face / @import / <link>: the PDF engine must never wait on the
  // network. Brand fonts are named first (used when installed on the host) with
  // bundled system fallbacks, so rendering is offline and instant.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Payslip ${esc(p.payslip_number || "")}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#EDE9E4; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:'Montserrat','Helvetica Neue',Arial,sans-serif; color:${ink}; font-size:12px; }
  .sheet { width:210mm; min-height:297mm; margin:0 auto; background:#fff; padding:16mm 16mm 13mm; position:relative; }
  .serif { font-family:'Playfair Display',Georgia,serif; }
  .mono  { font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace; }
  .eyebrow { font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:6px; }

  /* header */
  .head { display:flex; justify-content:space-between; align-items:flex-start; }
  .brandrow { display:flex; align-items:center; gap:13px; }
  .monogram { width:46px; height:46px; border-radius:9px; display:flex; align-items:center; justify-content:center;
        color:#fff; font-family:'Playfair Display',Georgia,serif; font-size:22px; font-weight:600; letter-spacing:1px; }
  .coname { font-size:24px; font-weight:600; color:${accentDeep}; line-height:1.05; }
  .cotag  { font-size:10px; color:${muted}; margin-top:3px; letter-spacing:.4px; }
  .doctitle { font-size:32px; font-weight:700; color:${accent}; letter-spacing:1px; text-align:right; line-height:1; }
  .docno { font-family:'JetBrains Mono',monospace; font-size:11px; color:${muted}; text-align:right; margin-top:6px; letter-spacing:.5px; }
  .pill { display:inline-block; margin-top:8px; color:#fff; font-size:9px; font-weight:700; letter-spacing:1.5px;
        text-transform:uppercase; padding:4px 11px; border-radius:20px; }
  .rule { height:2px; background:${accent}; margin-top:13px; }

  /* identity band */
  .band { display:flex; gap:22px; margin-top:16px; }
  .band > div { flex:1; }
  .who { font-family:'Playfair Display',Georgia,serif; font-size:19px; font-weight:600; color:${ink}; margin-bottom:8px; line-height:1.2; }
  table.kv { border-collapse:collapse; width:100%; }
  table.kv .k { color:${muted}; font-size:10.5px; padding:2.5px 14px 2.5px 0; white-space:nowrap; vertical-align:top; }
  table.kv .v { font-size:10.5px; font-weight:600; padding:2.5px 0; text-align:right; }
  table.kv .v.mono { font-family:'JetBrains Mono',monospace; font-weight:500; }

  /* ledgers */
  .ledgers { display:flex; gap:18px; margin-top:20px; }
  table.ledger { width:100%; border-collapse:collapse; }
  table.ledger thead th { background:${accent}; color:#fff; text-align:left; font-size:9.5px; font-weight:600;
        letter-spacing:1.4px; text-transform:uppercase; padding:8px 11px; }
  table.ledger thead th.r { text-align:right; }
  table.ledger td { padding:7.5px 11px; border-bottom:1px solid ${hairline}; font-size:11px; vertical-align:top; }
  table.ledger tr.zebra td { background:${tint(accent, 0.965)}; }
  .l-num { text-align:right; font-family:'JetBrains Mono',monospace; white-space:nowrap; width:112px; }
  .l-empty { color:${muted}; font-style:italic; }
  .l-tot { border-top:2px solid ${accent}; border-bottom:none !important; font-weight:700; font-size:11.5px;
        letter-spacing:.4px; padding-top:9px !important; }

  /* net pay */
  .net { margin-top:20px; border:1px solid ${accent}; border-left:4px solid ${accent}; border-radius:7px;
        background:${tint(accent, 0.955)}; padding:15px 20px; display:flex; justify-content:space-between; align-items:center; gap:20px; }
  .net-label { font-size:10px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:${accent}; }
  .net-words { font-size:10.5px; color:${muted}; margin-top:5px; line-height:1.5; max-width:105mm; }
  .net-figure { font-family:'Playfair Display',Georgia,serif; font-size:30px; font-weight:700; color:${accent};
        white-space:nowrap; line-height:1; }
  .net-sub { font-size:9px; color:${muted}; text-align:right; margin-top:5px; letter-spacing:.8px; }

  /* lower panels */
  .lower { display:flex; gap:18px; margin-top:20px; align-items:flex-start; }
  .lower > * { flex:1; }
  .panel { border:1px solid ${hairline}; border-radius:6px; padding:13px 15px; }
  .panel-note { font-size:9.5px; color:${muted}; line-height:1.5; margin-top:8px; }
  .query { margin-top:18px; padding:11px 15px; border-left:3px solid ${tint(accent, 0.55)};
        background:${tint(accent, 0.975)}; border-radius:0 6px 6px 0; font-size:9.5px; color:${muted}; line-height:1.6; }
  .query strong { color:${accentDeep}; }

  /* footer */
  .foot { position:absolute; left:16mm; right:16mm; bottom:10mm; }
  .foot .hair { height:1px; background:${hairline}; margin-bottom:8px; }
  .foot .row { display:flex; justify-content:space-between; gap:16px; font-size:9px; color:${muted}; line-height:1.5; }
  .foot .id { color:${accentDeep}; font-weight:600; }
</style></head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="brandrow">
        ${brandMark(brand)}
        <div>
          ${brand.logo_url ? "" : `<div class="coname serif">${esc(brand.brand_name)}</div>`}
          <div class="cotag">${esc(brand.brand_legal_name || brand.brand_name || "")}</div>
        </div>
      </div>
      <div>
        <div class="doctitle serif">PAYSLIP</div>
        <div class="docno">${esc(p.payslip_number || "")}</div>
        <div style="text-align:right"><span class="pill" style="background:${statusTone}">${esc(titleise(status))}</span></div>
      </div>
    </div>
    <div class="rule"></div>

    <div class="band">
      <div>
        <div class="eyebrow" style="color:${accent}">Employee</div>
        <div class="who">${esc(p.staff_name || "—")}</div>
        <table class="kv">${employeeRows}</table>
      </div>
      <div>
        <div class="eyebrow" style="color:${accent}">Pay period</div>
        <div class="who">${esc(periodLabel || "—")}</div>
        <table class="kv">${periodRows}</table>
      </div>
    </div>

    <div class="ledgers">
      <div style="flex:1">${ledger({
        title: "Earnings",
        rows: earnings.rows,
        total: earnings.total,
        totalLabel: "Gross pay",
        accent,
      })}</div>
      <div style="flex:1">${ledger({
        title: "Deductions",
        rows: deductions.rows,
        total: deductions.total,
        totalLabel: "Total deductions",
        accent,
        negative: true,
      })}</div>
    </div>

    <div class="net">
      <div>
        <div class="net-label">Net pay</div>
        <div class="net-words">${esc(nairaInWords(p.net_pay_ngn))}</div>
      </div>
      <div>
        <div class="net-figure">${esc(ngn(p.net_pay_ngn))}</div>
        <div class="net-sub">Gross ${esc(ngn(earnings.total))} less deductions ${esc(ngn(deductions.total))}</div>
      </div>
    </div>

    <div class="lower">
      <div class="panel">
        <div class="eyebrow" style="color:${accent}">Payment details</div>
        <table class="kv">${paymentRows}</table>
      </div>
      ${employerBlock || '<div style="border:0"></div>'}
    </div>

    <div class="query">
      Queries on this payslip should be raised with People &amp; Culture${
        brand.support_email ? ` at ${esc(brand.support_email)}` : ""
      } within 14 days of the pay date. Attendance deductions can be appealed
      from <strong>My HR → Attendance</strong> in the Hub, where each flagged day
      shows the reason recorded and lets you respond.
    </div>

    <div class="foot">
      <div class="hair"></div>
      <div class="row">
        <div><span class="id">${footerId}</span>${contactLine ? `<br/>${contactLine}` : ""}</div>
        <div style="text-align:right">This payslip is confidential and intended solely for the named employee.<br/>
        Computer-generated on ${esc(formatDate(new Date()))} — no signature required.</div>
      </div>
    </div>
  </div>
</body></html>`;
}

module.exports = {
  payslipHtml,
  nairaInWords,
  groupLines,
  ledgersFromColumns,
  reconcile,
  maskAccount,
};
