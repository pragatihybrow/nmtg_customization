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

    // Rows are fixed height in the grid; make them tall enough for the multi-line Item Details
    get_datatable_options: function (options) {
        return Object.assign(options, { cellHeight: 130 });
    },

    formatter: function (value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);

        if (column.fieldname === "item_details" && data && data.item_details) {
            var label_re = /^(SIZE|Description|Customer Item Code|Drg No\.?)\s*:/i;
            var lines = data.item_details.split("\n").map(function (line, idx) {
                var text = frappe.utils.escape_html(line);
                if (idx === 0) return "<b>" + text + "</b>";
                var m = line.match(label_re);
                if (m) {
                    var label = frappe.utils.escape_html(line.slice(0, m[0].length));
                    var rest = frappe.utils.escape_html(line.slice(m[0].length));
                    return "<span style='color:red'>" + label + "</span>" + rest;
                }
                return text;
            });
            return "<div style='white-space: normal; line-height: 1.3; overflow: visible;'>" +
                lines.join("<br>") + "</div>";
        }
        return value;
    },
};