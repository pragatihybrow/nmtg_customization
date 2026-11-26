// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Item Wise Quotation Report"] = {
    filters: [
        {
            fieldname: "item_code",
            label: __("Item"),
            fieldtype: "MultiSelectList",
            options: "Item",
            get_data: function (txt) {
                return frappe.db.get_link_options("Item", txt);
            },
        },
        {
            fieldname: "customer",
            label: __("Customer"),
            fieldtype: "Link",
            options: "Customer",
        },
        {
            fieldname: "from_date",
            label: __("From Date"),
            fieldtype: "Date",
            default: frappe.datetime.add_months(frappe.datetime.get_today(), -12),
        },
        {
            fieldname: "to_date",
            label: __("To Date"),
            fieldtype: "Date",
            default: frappe.datetime.get_today(),
        },
        {
            fieldname: "status",
            label: __("Status"),
            fieldtype: "Select",
            options: "\nDraft\nOpen\nReplied\nPartially Ordered\nOrdered\nLost\nCancelled\nExpired",
        },
    ],

    formatter: function (value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);

        // Keep the multi-line item details readable in the grid
        if (column.fieldname === "item_details" && data && data.item_details) {
            var lines = frappe.utils.escape_html(data.item_details).split("\n");
            lines[0] = "<b>" + lines[0] + "</b>";
            return "<div style='white-space: normal; line-height: 1.3;'>" + lines.join("<br>") + "</div>";
        }
        return value;
    },
};