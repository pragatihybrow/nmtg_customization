// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.ui.form.on("Logistic", {
    select_wooden_box: function (frm) {
        set_item_size(frm, "select_wooden_box", "wooden_box_size");
    },

    select_corrugated_box: function (frm) {
        set_item_size(frm, "select_corrugated_box", "corrugated_box_size");
    },

    refresh: function (frm) {
        // Fill sizes for existing docs where they were never set
        if (!frm.is_new() && frm.doc.docstatus === 0) {
            if (frm.doc.select_wooden_box && !frm.doc.wooden_box_size) {
                set_item_size(frm, "select_wooden_box", "wooden_box_size");
            }
            if (frm.doc.select_corrugated_box && !frm.doc.corrugated_box_size) {
                set_item_size(frm, "select_corrugated_box", "corrugated_box_size");
            }
        }
    }
});

function set_item_size(frm, item_field, size_field) {
    if (!frm.fields_dict[size_field]) {
        console.error(
            `Logistic: field "${size_field}" not found. Check the fieldname in the DocType.`
        );
        return;
    }

    let item_code = frm.doc[item_field];

    if (!item_code) {
        frm.set_value(size_field, "");
        return;
    }

    frappe.db
        .get_value("Item", item_code, [
            "custom_width",
            "custom_width_uom",
            "custom_tl",
            "custom_total_length_uom",
            "custom_height",
            "custom_height_uom"
        ])
        .then(r => {
            let item = r.message || {};

            let parts = [
                [item.custom_width, item.custom_width_uom],
                [item.custom_tl, item.custom_total_length_uom],
                [item.custom_height, item.custom_height_uom]
            ]
                .filter(([value]) => value)
                .map(([value, uom]) => `${value} ${uom || ""}`.trim());

            frm.set_value(size_field, parts.join(" * "));
        });
}