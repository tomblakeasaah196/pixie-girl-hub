"use strict";

/**
 * Full organigramme PDF — the HTML the browser turns into the stored PDF.
 * Pure render: asserts the layout crosses department boundaries, department
 * badges appear, empty state renders, and HTML-escaping holds.
 */

const {
  chartHtml,
  buildLayout,
} = require("../../../src/shared/org_workflow/org.chart-pdf");

const units = [
  { unit_id: "u-top", display_name: "Top Management", unit_key: "top_management" },
  { unit_id: "u-mkt", display_name: "Marketing", unit_key: "marketing" },
  { unit_id: "u-ops", display_name: "Operations", unit_key: "operations" },
];

const positions = [
  {
    position_id: "p-ceo",
    unit_id: "u-top",
    unit_name: "Top Management",
    display_name: "Chief Executive Officer",
    position_key: "ceo",
    reports_to_position_id: null,
    is_management: true,
    is_deputy: false,
    holder_name: "Tom-Blake A.",
    role_name: "CEO",
    display_order: 0,
    approval_threshold_ngn: null,
  },
  {
    position_id: "p-mkt-mgr",
    unit_id: "u-mkt",
    unit_name: "Marketing",
    display_name: "Marketing and Business Development Manager",
    position_key: "marketing_and_business_development_manager",
    reports_to_position_id: "p-ceo",
    is_management: true,
    is_deputy: false,
    holder_name: null,
    role_name: null,
    display_order: 0,
    approval_threshold_ngn: 200000,
  },
  {
    position_id: "p-content",
    unit_id: "u-mkt",
    unit_name: "Marketing",
    display_name: "Content Creator",
    position_key: "content_creator",
    reports_to_position_id: "p-mkt-mgr",
    is_management: false,
    is_deputy: true,
    holder_name: null,
    role_name: null,
    display_order: 0,
    approval_threshold_ngn: null,
  },
  {
    position_id: "p-ops-mgr",
    unit_id: "u-ops",
    unit_name: "Operations",
    display_name: "Operations Manager",
    position_key: "operations_manager",
    reports_to_position_id: "p-ceo",
    is_management: true,
    is_deputy: false,
    holder_name: "Ada N.",
    role_name: null,
    display_order: 1,
    approval_threshold_ngn: null,
  },
];

describe("buildLayout", () => {
  it("places the root at column 0 and children in later columns, crossing department boundaries", () => {
    const layout = buildLayout(positions);
    const byId = new Map(layout.map((n) => [n.pos.position_id, n]));
    expect(byId.get("p-ceo").x).toBeLessThan(byId.get("p-mkt-mgr").x);
    expect(byId.get("p-mkt-mgr").x).toBeLessThan(byId.get("p-content").x);
    // Marketing and Operations positions coexist in the same tree (via the CEO).
    expect(byId.get("p-ops-mgr").x).toBe(byId.get("p-mkt-mgr").x);
  });

  it("returns an empty layout for no positions", () => {
    expect(buildLayout([])).toEqual([]);
  });
});

describe("chartHtml", () => {
  it("renders every department's positions in one document", () => {
    const html = chartHtml({ brand: "pixiegirl", units, positions });
    expect(html).toContain("Chief Executive Officer");
    expect(html).toContain("Marketing and Business Development Manager");
    expect(html).toContain("Content Creator");
    expect(html).toContain("Operations Manager");
  });

  it("labels each node with its department and shows the holder", () => {
    const html = chartHtml({ brand: "pixiegirl", units, positions });
    expect(html).toContain(">Marketing<");
    expect(html).toContain(">Operations<");
    expect(html).toContain("Ada N.");
    expect(html).toContain("Vacant");
  });

  it("shows the department legend and Full Organigramme heading", () => {
    const html = chartHtml({ brand: "pixiegirl", units, positions });
    expect(html).toContain("Full Organigramme");
    expect(html).toContain("Pixie Girl Global");
    expect(html).toContain("3 departments");
    expect(html).toContain("4 positions");
  });

  it("renders an empty state when there are no positions", () => {
    const html = chartHtml({ brand: "faitlynhair", units, positions: [] });
    expect(html).toContain("No organisation structure yet.");
    expect(html).toContain("Faitlyn Hair");
  });

  it("escapes untrusted names (no injection)", () => {
    const html = chartHtml({
      brand: "pixiegirl",
      units,
      positions: [
        { ...positions[0], display_name: "<script>x</script>" },
      ],
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
