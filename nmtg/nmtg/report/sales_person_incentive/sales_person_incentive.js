// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Sales Person Incentive"] = {
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
            fieldname: "fiscal_year",
            label: __("Fiscal Year"),
            fieldtype: "Link",
            options: "Fiscal Year",
            default: frappe.defaults.get_user_default("fiscal_year"),
        },
        {
            fieldname: "sales_person",
            label: __("Sales Person"),
            fieldtype: "Link",
            options: "Sales Person",
        },
        {
            fieldname: "monthly_salary",
            label: __("Monthly Salary (override)"),
            fieldtype: "Currency",
        },
        {
            fieldname: "min_achievement",
            label: __("Min Achievement % for Eligibility"),
            fieldtype: "Float",
            default: 80,
        },
        {
            fieldname: "max_achievement",
            label: __("Max Achievement % Considered"),
            fieldtype: "Float",
            default: 120,
        },
        {
            fieldname: "incentive_percent",
            label: __("Incentive % of Salary"),
            fieldtype: "Float",
            default: 20,
        },
    ],

    formatter: function (value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);
        if (!data) return value;

        if (data.is_total) {
            return `<span style="font-weight:700">${value}</span>`;
        }
        if (column.fieldname === "eligible") {
            const color = data.eligible === "Yes" ? "green" : "red";
            value = `<span style="color:${color}; font-weight:600">${value}</span>`;
        }
        return value;
    },
};