// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Sales Target Achievement"] = {
    filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
            reqd: 1,
        },
        {
            fieldname: "as_on_date",
            label: __("As On Date"),
            fieldtype: "Date",
            default: frappe.datetime.get_today(),
            reqd: 1,
        },
        {
            fieldname: "customer",
            label: __("Customer"),
            fieldtype: "Link",
            options: "Customer",
        },
        {
            fieldname: "sales_person",
            label: __("Sales Person"),
            fieldtype: "Link",
            options: "Sales Person",
        },
        {
            fieldname: "factor",
            label: __("Factor"),
            fieldtype: "Select",
            options: [
                "",
                "Net Sales Order Value",
                "Overdue Collection",
                "Quotation-to-Order Conversion",
                "CRM Follow-up Compliance",
                "Dispatch Value",
                "Lead-to-Enquiry Ratio",
                "Lead to SO - Mkt Net order value",
                "Direct enquiry - SO : Direct SO value",
                "Repeat customer SO value",
            ].join("\n"),
        },
    ],

    formatter: function (value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);
        if (column.fieldname === "achievement_pct" && data) {
            const pct = data.achievement_pct || 0;
            const color = pct >= 100 ? "green" : pct >= 60 ? "orange" : "red";
            value = `<span style="color:${color}; font-weight:600">${value}</span>`;
        }
        return value;
    },
};