// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Late Delivery Report"] = {
    filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
        },
        {
            fieldname: "customer",
            label: __("Customer"),
            fieldtype: "Link",
            options: "Customer",
        },
        {
            fieldname: "sales_order",
            label: __("Sales Order"),
            fieldtype: "Link",
            options: "Sales Order",
        },
        {
            fieldname: "status",
            label: __("Status"),
            fieldtype: "Select",
            options: [
                "",
                "On Time",
                "All Overdue",
                "Overdue (Delivered)",
                "Overdue (Pending)",
                "Upcoming",
                "No Committed Date",
            ].join("\n"),
        },
        {
            fieldname: "from_date",
            label: __("From Date"),
            fieldtype: "Date",
            default: frappe.datetime.add_months(frappe.datetime.get_today(), -3),
        },
        {
            fieldname: "to_date",
            label: __("To Date"),
            fieldtype: "Date",
            default: frappe.datetime.get_today(),
        },
    ],

    // Blank out numeric/date cells on the parent (SO) row instead of showing 0 / ₹0.00 / 0%
    formatter: function (value, row, column, data, default_formatter) {
        const blank_on_parent = [
            "qty",
            "delivery_note",
            "committed_delivery_date",
            "production_delivery_date",
            "nmtg_dispatch_date",
            "material_received_date",
            "due_in_weeks",
            "base_amount",
            "ld_percentage",
            "custom_frequency",
            "periods_overdue",
            "ld_amount",
            "ld_amount_deducted",
        ];

        if (data && data.indent === 0 && blank_on_parent.includes(column.fieldname)) {
            return "";
        }

        return default_formatter(value, row, column, data);
    },
};