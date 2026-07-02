/**
 * Dashboards (V2.2 §6.20) — column manifests for detail tables.
 *
 * One place that says, per drill-down table, which columns exist, their
 * labels and display format. Shared by the detail endpoint (the frontend
 * renders straight from it), the in-payload top-N tables, and the Excel
 * exporter (sheet headers + number formats).
 *
 * Formats: money · int · num · pct · date · datetime · bool · text
 */

"use strict";

const col = (key, label, format = "text") => ({ key, label, format });

const DETAIL_COLUMNS = {
  sales: {
    orders: [
      col("order_number", "Order #"),
      col("placed_at", "Placed", "datetime"),
      col("customer", "Customer"),
      col("sales_channel", "Channel"),
      col("status", "Status"),
      col("total_ngn", "Total ₦", "money"),
      col("amount_paid_ngn", "Paid ₦", "money"),
      col("balance_due_ngn", "Balance ₦", "money"),
    ],
    payments: [
      col("payment_number", "Payment #"),
      col("captured_at", "Captured", "datetime"),
      col("order_number", "Order #"),
      col("method", "Method"),
      col("provider", "Provider"),
      col("status", "Status"),
      col("amount_ngn", "Amount ₦", "money"),
      col("fee_ngn", "Fee ₦", "money"),
      col("net_received_ngn", "Net ₦", "money"),
    ],
  },
  customers: {
    top_customers: [
      col("display_name", "Customer"),
      col("orders", "Orders", "int"),
      col("revenue", "Revenue ₦", "money"),
      col("last_order_at", "Last Order", "datetime"),
    ],
    deals: [
      col("deal_number", "Deal #"),
      col("title", "Title"),
      col("contact", "Contact"),
      col("stage", "Stage"),
      col("expected_value_ngn", "Value ₦", "money"),
      col("expected_close_date", "Expected Close", "date"),
      col("last_activity_at", "Last Activity", "datetime"),
    ],
    at_risk: [
      col("customer", "Customer"),
      col("risk_band", "Band"),
      col("risk_score", "Score", "int"),
      col("days_since_last_order", "Days Since Order", "int"),
      col("total_orders", "Orders", "int"),
      col("lifetime_value_ngn", "Lifetime ₦", "money"),
      col("computed_at", "Scored", "datetime"),
    ],
  },
  finance: {
    receivables: [
      col("invoice_number", "Invoice #"),
      col("customer", "Customer"),
      col("status", "Status"),
      col("issue_date", "Issued", "date"),
      col("due_date", "Due", "date"),
      col("days_overdue", "Days Overdue", "int"),
      col("total_ngn", "Total ₦", "money"),
      col("balance_due_ngn", "Balance ₦", "money"),
    ],
    expenses: [
      col("expense_number", "Expense #"),
      col("title", "Title"),
      col("expense_date", "Date", "date"),
      col("expense_type", "Type"),
      col("status", "Status"),
      col("total_amount_ngn", "Amount ₦", "money"),
    ],
  },
  stock: {
    low_stock: [
      col("product", "Product"),
      col("variant_name", "Variant"),
      col("sku", "SKU"),
      col("location", "Location"),
      col("on_hand", "On Hand", "int"),
      col("available", "Available", "int"),
      col("reorder_point", "Reorder Point", "int"),
      col("daily_velocity", "Daily Velocity", "num"),
      col("projected_days_left", "Days Left", "num"),
      col("severity", "Severity"),
      col("detected_at", "Detected", "datetime"),
    ],
    movements: [
      col("movement_number", "Movement #"),
      col("performed_at", "When", "datetime"),
      col("product", "Product"),
      col("sku", "SKU"),
      col("movement_type", "Type"),
      col("sales_channel", "Channel"),
      col("quantity", "Qty", "int"),
      col("location", "Location"),
    ],
  },
  logistics: {
    deliveries: [
      col("delivery_number", "Delivery #"),
      col("recipient", "Recipient"),
      col("courier", "Courier"),
      col("status", "Status"),
      col("booked_at", "Booked", "datetime"),
      col("expected_delivery_at", "Expected", "datetime"),
      col("delivered_at", "Delivered", "datetime"),
      col("attempt_count", "Attempts", "int"),
      col("courier_fee_ngn", "Fee ₦", "money"),
    ],
  },
  marketing: {
    email_campaigns: [
      col("campaign_name", "Campaign"),
      col("campaign_type", "Type"),
      col("status", "Status"),
      col("send_started_at", "Sent", "datetime"),
      col("total_sent", "Sent", "int"),
      col("total_delivered", "Delivered", "int"),
      col("total_opened", "Opened", "int"),
      col("total_clicked", "Clicked", "int"),
      col("open_rate_pct", "Open %", "pct"),
      col("click_rate_pct", "Click %", "pct"),
      col("conversion_revenue_ngn", "Revenue ₦", "money"),
    ],
    ad_campaigns: [
      col("name", "Campaign"),
      col("platform", "Platform"),
      col("objective", "Objective"),
      col("status", "Status"),
      col("spend_ngn", "Spend ₦", "money"),
      col("clicks", "Clicks", "int"),
      col("conversions", "Conversions", "int"),
      col("conversion_value_ngn", "Return ₦", "money"),
    ],
  },
  ecommerce: {
    storefront_orders: [
      col("order_number", "Order #"),
      col("placed_at", "Placed", "datetime"),
      col("customer", "Customer"),
      col("status", "Status"),
      col("display_currency", "Currency"),
      col("display_total", "Display Total", "num"),
      col("total_ngn", "Total ₦", "money"),
      col("utm_source", "Source"),
    ],
    sessions: [
      col("started_at", "Started", "datetime"),
      col("utm_source", "Source"),
      col("utm_campaign", "Campaign"),
      col("referrer", "Referrer"),
      col("device_type", "Device"),
      col("region", "Region"),
      col("detected_currency", "Currency"),
      col("page_count", "Pages", "int"),
      col("duration_seconds", "Duration (s)", "int"),
      col("converted", "Converted", "bool"),
      col("conversion_value_ngn", "Order ₦", "money"),
    ],
  },
  retention: {
    referral_redemptions: [
      col("created_at", "When", "datetime"),
      col("referrer", "Referrer"),
      col("referred", "Referred"),
      col("status", "Status"),
      col("order_value_ngn", "Order ₦", "money"),
      col("referrer_reward_points", "Reward Points", "int"),
      col("fraud_check_result", "Fraud Check"),
    ],
    coupon_redemptions: [
      col("redeemed_at", "When", "datetime"),
      col("coupon_code", "Coupon"),
      col("customer", "Customer"),
      col("discount_applied_ngn", "Discount ₦", "money"),
      col("reference_type", "Applied On"),
    ],
    subscriptions: [
      col("customer", "Customer"),
      col("plan", "Plan"),
      col("status", "Status"),
      col("started_at", "Started", "datetime"),
      col("next_billing_at", "Next Billing", "datetime"),
      col("total_cycles_billed", "Cycles", "int"),
      col("total_billed_ngn", "Billed ₦", "money"),
    ],
  },
  hr: {
    leave_requests: [
      col("staff", "Staff"),
      col("job_title", "Role"),
      col("leave_type", "Type"),
      col("start_date", "From", "date"),
      col("end_date", "To", "date"),
      col("days_requested", "Days", "num"),
      col("status", "Status"),
      col("reason", "Reason"),
    ],
    payroll_runs: [
      col("run_number", "Run #"),
      col("pay_year", "Year", "int"),
      col("pay_month", "Month", "int"),
      col("pay_date", "Pay Date", "date"),
      col("status", "Status"),
      col("total_staff", "Staff", "int"),
      col("total_gross_ngn", "Gross ₦", "money"),
      col("total_commission_ngn", "Commission ₦", "money"),
      col("total_net_ngn", "Net ₦", "money"),
    ],
    commissions: [
      col("earning_number", "Earning #"),
      col("staff", "Staff"),
      col("sale_channel", "Channel"),
      col("status", "Status"),
      col("earned_at", "Earned", "datetime"),
      col("basis_amount_ngn", "Basis ₦", "money"),
      col("commission_amount_ngn", "Commission ₦", "money"),
    ],
  },
};

/** In-payload top-N table columns, per domain.table key. */
const TABLE_COLUMNS = {
  "overview.pending_approvals": [
    col("workflow", "Workflow"),
    col("reference_table", "For"),
    col("current_stage", "Stage", "int"),
    col("initiated_by", "Initiated By"),
    col("initiated_at", "Initiated", "datetime"),
  ],
  "sales.top_products": [
    col("label", "Product"),
    col("units", "Units", "int"),
    col("value", "Revenue ₦", "money"),
  ],
  "customers.top_customers": [
    col("display_name", "Customer"),
    col("orders", "Orders", "int"),
    col("revenue", "Revenue ₦", "money"),
    col("last_order_at", "Last Order", "datetime"),
  ],
  "finance.overdue_invoices": DETAIL_COLUMNS.finance.receivables,
  "stock.low_stock": DETAIL_COLUMNS.stock.low_stock,
  "logistics.courier_scorecard": [
    col("label", "Courier"),
    col("total", "Deliveries", "int"),
    col("delivered", "Delivered", "int"),
    col("failed", "Failed", "int"),
    col("success_rate", "Success %", "pct"),
    col("avg_hours", "Avg Hours", "num"),
    col("fees", "Fees ₦", "money"),
  ],
  "marketing.campaigns": [
    col("label", "Campaign"),
    col("visitors", "Visitors", "int"),
    col("orders", "Orders", "int"),
    col("value", "Revenue ₦", "money"),
  ],
  "ecommerce.top_sources": [
    col("label", "Source"),
    col("sessions", "Sessions", "int"),
    col("conversions", "Conversions", "int"),
  ],
  "retention.top_referrers": [
    col("label", "Referrer"),
    col("conversions", "Conversions", "int"),
    col("revenue", "Revenue ₦", "money"),
  ],
  "hr.pending_leave": DETAIL_COLUMNS.hr.leave_requests,
};

module.exports = { DETAIL_COLUMNS, TABLE_COLUMNS };
