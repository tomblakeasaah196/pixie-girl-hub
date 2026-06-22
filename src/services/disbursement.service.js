/**
 * Salary disbursement — provider-agnostic (HR Phase 2).
 *
 * The meeting confirmed Nomba as the payout rail (answer #7), but Nomba's
 * payout API details were still being confirmed (action item). So this layer
 * is deliberately provider-agnostic: it selects the brand's configured provider
 * and falls back to a "manual" bank-schedule (queued, settle out-of-band) when
 * the provider isn't configured — payroll never blocks on the integration.
 *
 * `disburseSlip` returns a normalized result the payroll service maps onto the
 * payslip's payment_status:
 *   { status: 'paid' | 'queued' | 'failed', reference, reason }
 */

"use strict";

const nomba = require("./nomba.service");
const logger = require("../config/logger");

/** Resolve the effective provider for a brand's HR settings. */
function selectProvider(settings) {
  const p = settings && settings.payout_provider;
  return p === "flutterwave" || p === "manual" ? p : "nomba";
}

/** Map a payslip row to the destination bank account fields. */
function bankDetails(slip) {
  return {
    account_number: slip.bank_account_snapshot || null,
    amount_ngn: Number(slip.net_pay_ngn || 0),
    narration: `Salary ${slip.payslip_number || ""}`.trim(),
  };
}

/**
 * Disburse a single payslip. Best-effort and defensive: a provider error or
 * missing bank details never throws — it returns a 'failed'/'queued' result so
 * the run can still complete and HR can retry the failures.
 */
async function disburseSlip({ provider, slip, creds }) {
  const bank = bankDetails(slip);
  if (!bank.account_number) {
    return { status: "failed", reference: null, reason: "no_bank_account" };
  }
  if (bank.amount_ngn <= 0) {
    return { status: "paid", reference: null, reason: "zero_net" };
  }

  if (provider === "manual") {
    // Recorded for an out-of-band bank schedule; settled manually.
    return { status: "queued", reference: null, reason: "manual_schedule" };
  }

  if (provider === "nomba") {
    try {
      const res = await nomba.disburseSalary(
        {
          account_number: bank.account_number,
          bank_code: slip.bank_sort_code_snapshot || null,
          amount_ngn: bank.amount_ngn,
          narration: bank.narration,
          reference: `PAY-${slip.payslip_id}`,
        },
        creds,
      );
      if (res && res.ok) {
        return { status: "paid", reference: res.reference || null, reason: null };
      }
      // Not configured / declined → queue for manual settlement, don't fail hard.
      return {
        status: res && res.reason === "not_configured" ? "queued" : "failed",
        reference: null,
        reason: (res && res.reason) || "provider_declined",
      };
    } catch (err) {
      logger.error({ err, payslip_id: slip.payslip_id }, "disbursement failed");
      return { status: "failed", reference: null, reason: "provider_error" };
    }
  }

  // Unknown / not-yet-implemented provider (e.g. flutterwave): queue.
  return { status: "queued", reference: null, reason: "provider_unavailable" };
}

module.exports = { selectProvider, bankDetails, disburseSlip };
