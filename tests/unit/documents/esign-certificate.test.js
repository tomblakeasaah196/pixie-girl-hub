"use strict";

/**
 * Signature certificate HTML (the "signature block" stamped onto the signed
 * document). Pure render — asserts the block carries the signer, the drawn
 * signature image, the verification code, and the VERIFIED seal, and that
 * untrusted text is escaped.
 */

const {
  signatureCertificateHtml,
  maskIp,
  fmtWat,
} = require("../../../src/shared/documents/documents.esign.certificate");

const baseArgs = {
  brand: "pixiegirl",
  request: {
    subject: "Employment Contract",
    request_type: "employment_contract",
    request_id: "req-123",
    fully_signed_at: "2026-07-05T09:42:17.000Z",
  },
  document: { title: "Employment Contract — Sales Associate", document_number: "DOC-2026-0347" },
  signers: [
    {
      display_name: "Amara Obi",
      signer_role: "Employee",
      signed_at: "2026-07-05T09:42:17.000Z",
      signed_ip: "102.89.44.21",
      verification_code: "A4F8-E2C9-1B3D",
      signature_src: "data:image/png;base64,AAAABBBB",
    },
  ],
};

describe("signatureCertificateHtml", () => {
  it("renders each signer's name, role, code and a VERIFIED seal", () => {
    const html = signatureCertificateHtml(baseArgs);
    expect(html).toContain("Amara Obi");
    expect(html).toContain("Employee");
    expect(html).toContain("A4F8-E2C9-1B3D");
    expect(html).toContain("VERIFIED");
    expect(html).toContain("Signature Certificate");
  });

  it("embeds the drawn signature image", () => {
    const html = signatureCertificateHtml(baseArgs);
    expect(html).toContain('src="data:image/png;base64,AAAABBBB"');
  });

  it("masks the signer IP", () => {
    const html = signatureCertificateHtml(baseArgs);
    expect(html).toContain("102.89.44.***");
    expect(html).not.toContain("102.89.44.21<");
  });

  it("falls back to a typed name when there is no signature image", () => {
    const html = signatureCertificateHtml({
      ...baseArgs,
      signers: [{ ...baseArgs.signers[0], signature_src: null }],
    });
    expect(html).toContain("sig-typed");
    expect(html).toContain("Amara Obi");
  });

  it("escapes untrusted signer text (no HTML injection)", () => {
    const html = signatureCertificateHtml({
      ...baseArgs,
      signers: [
        { ...baseArgs.signers[0], display_name: "<script>alert(1)</script>" },
      ],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("maskIp", () => {
  it("masks the final IPv4 octet", () => {
    expect(maskIp("102.89.44.21")).toBe("102.89.44.***");
  });
  it("strips an IPv4-mapped IPv6 prefix", () => {
    expect(maskIp("::ffff:102.89.44.21")).toBe("102.89.44.***");
  });
  it("returns an em dash for null", () => {
    expect(maskIp(null)).toBe("—");
  });
});

describe("fmtWat", () => {
  it("renders a WAT timestamp", () => {
    expect(fmtWat("2026-07-05T08:42:17.000Z")).toContain("WAT");
    expect(fmtWat(null)).toBe("—");
  });
});
