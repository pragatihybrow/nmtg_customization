// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Payment Plan Report"] = {
    filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
        },
        {
            fieldname: "supplier",
            label: __("Vendor"),
            fieldtype: "Link",
            options: "Supplier",
        },
        {
            fieldname: "purchase_order",
            label: __("Purchase Order"),
            fieldtype: "Link",
            options: "Purchase Order",
        },
        {
            fieldname: "item_code",
            label: __("Item"),
            fieldtype: "Link",
            options: "Item",
        },
        {
            fieldname: "from_date",
            label: __("Required By From"),
            fieldtype: "Date",
        },
        {
            fieldname: "to_date",
            label: __("Required By To"),
            fieldtype: "Date",
        },
    ],
};