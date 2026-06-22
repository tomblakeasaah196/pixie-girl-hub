/**
 * Contract generation (HR — onboarding & amendments).
 *
 * Generates an employment-contract PDF from the staff profile, stores it as a
 * document, and records a shared.staff_contracts row linked to it. The stored
 * document can then be routed through the existing e-signature flow
 * (shared/documents/documents.esign.*) — HR sends the contract document for
 * signing exactly like any other document.
 */

"use strict";

const repo = require("./contracts.repo");
const hrRepo = require("./hr_ops.repo");
const pdf = require("../../services/pdf.service");
const templates = require("../../services/pdf.templates");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError } = require("../../utils/errors");

async function listForProfile({ brand, profileId }) {
  // Ensure the profile is visible to this brand before listing.
  const profile = await hrRepo.profileById({ brand, profileId });
  if (!profile) throw new NotFoundError("Employee");
  return { data: await repo.listForProfile({ profileId }) };
}

async function generateContract({ brand, user, request_id, profileId, input }) {
  return transaction(async (client) => {
    const profile = await hrRepo.profileById({ client, brand, profileId });
    if (!profile) throw new NotFoundError("Employee");

    const grossSalary =
      input.gross_salary !== null && input.gross_salary !== undefined && input.gross_salary !== ""
        ? Number(input.gross_salary)
        : Number(profile.base_salary || 0);

    const contract = {
      contract_type: input.contract_type || profile.employment_type || "full_time",
      effective_from: input.effective_from || profile.start_date,
      effective_to: input.effective_to || null,
      gross_salary: grossSalary,
      notes: input.notes || null,
    };

    const brandName = await repo.businessName({ client, brand });
    const html = templates.contractHtml({
      brand: { display_name: brandName || brand },
      contract,
      staff: {
        display_name: profile.display_name,
        employee_number: profile.employee_number,
        job_title: profile.job_title,
        department: profile.department,
      },
    });

    const doc = await pdf.renderAndStore({
      brand,
      user_id: user.user_id,
      html,
      title: `Contract — ${profile.employee_number}`,
      document_type: "contract",
      reference_type: "staff_profile",
      reference_id: profileId,
      client,
      request_id,
    });

    const row = await repo.createContract({
      client,
      input: { ...contract, profile_id: profileId, document_id: doc.document_id, created_by: user.user_id },
    });

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.generate_contract",
      target_type: "staff_contracts",
      target_id: row.contract_id,
      after: { document_id: doc.document_id, contract_type: row.contract_type },
      request_id,
      is_sensitive: true,
    });

    return { ...row, document: doc };
  });
}

module.exports = { listForProfile, generateContract };
