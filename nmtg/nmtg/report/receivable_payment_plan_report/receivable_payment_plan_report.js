// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Receivable Payment Plan Report"] = {
    tree: true,
    name_field: "name",
    parent_field: "parent_so",
    initial_depth: 0,
    filters: [
        { fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company",
          default: frappe.defaults.get_user_default("Company") },
        { fieldname: "customer", label: __("Customer"), fieldtype: "Link", options: "Customer" },
        { fieldname: "sales_order", label: __("Sales Order"), fieldtype: "Link", options: "Sales Order" },
        { fieldname: "from_date", label: __("SO From Date"), fieldtype: "Date" },
        { fieldname: "to_date", label: __("SO To Date"), fieldtype: "Date" },
        { fieldname: "status", label: __("Status"), fieldtype: "Select",
          options: "\nPending\nPartly Paid\nOverdue\nPaid" },
    ],
    formatter: function (value, row, column, data, default_formatter) {
        // Hide the Payment Schedule row ID on installment (child) rows.
        // The ID is still in the data, so the tree grouping keeps working.
        if (column.fieldname === "name" && data && data.indent === 1) {
            return "";
        }

        value = default_formatter(value, row, column, data);

        if (column.fieldname === "status" && data) {
            const colors = { Paid: "green", Overdue: "red", "Partly Paid": "orange", Pending: "gray" };
            const c = colors[data.status];
            if (c) value = `<span class="indicator-pill ${c}">${data.status}</span>`;
        }
        return value;
    },
};