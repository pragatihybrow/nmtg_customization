frappe.ui.form.on("Purchase Order Item", {

    custom_quantity_in_mm: frappe.utils.debounce(
        (frm, cdt, cdn) => calculate_formula(frm, cdt, cdn),
        400
    ),

    item_code(frm, cdt, cdn) {
        calculate_formula(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        enforce_nos_rounding(frm, cdt, cdn);
    },

    conversion_factor(frm, cdt, cdn) {
        enforce_nos_rounding(frm, cdt, cdn);
    }

});


const item_cache = {};


// Formula field -> Item field
const FORMULA_FIELD_MAP = {

    "Diameter": "custom_diameter",
    "Width": "custom_width",
    "Height": "custom_height",
    "Thickness": "custom_thickness",
    "OD": "custom_od",
    "Pipe Size": "custom_pipe_size",
    "Spigot Diameter": "custom_spigot_diameter",
    "Groove": "custom_groove",
    "Drill": "custom_drill_value",
    "Deep": "custom_deep_value",
    "ID": "custom_id",
    "TL": "custom_tl",
    "Step": "custom_step",
    "Wired Length": "custom_wired_length",
    "Wired Diameter": "custom_wired_diameter",
    "Frame Value": "custom_frame_value",
    "Thread Size": "custom_thread_size",
    "No of Teeth": "custom_no_of_teeth",
    "Cross Sectional Width": "custom_cross_sectional_width",
    "Cross Sectional Thickness": "custom_cross_sectional_thickness",
    "Value of Pitch Diameter": "custom_value_of_pitch_diameter",
    "Value of Tooth Thickness": "custom_value_of_tooth_thickness",
    "Gap Between Spring And Coil": "custom_gap_between_spring_and_coil",
    "Value of Chain Pitch": "custom_value_of_chain_pitch",
    "Length": "custom_length"
};


function calculate_formula(frm, cdt, cdn) {

    const row = locals[cdt][cdn];

    if (!row.item_code || !row.custom_quantity_in_mm) {
        return;
    }

    get_item(row.item_code).then((item) => {

        if (!item) {
            return;
        }

        const entered_qty = flt(row.custom_quantity_in_mm);

        if (item.purchase_uom === item.stock_uom) {

            const qty_value = item.purchase_uom === "Nos"
                ? Math.round(entered_qty)
                : entered_qty;

            frappe.model.set_value(cdt, cdn, "qty", qty_value);

            if (item.purchase_uom) {
                frappe.model.set_value(cdt, cdn, "uom", item.purchase_uom);
            }

            return;
        }

        if (!item.custom_formula_for_conversion) {
            return;
        }

        const has_fixed_length = flt(item.custom_length) > 0;
        const length_value = has_fixed_length ? item.custom_length : entered_qty;

        let formula = item.custom_formula_for_conversion;

        for (const [field_label, fieldname] of Object.entries(FORMULA_FIELD_MAP)) {

            const regex = new RegExp(
                escape_regex(field_label) + "\\s*\\([^)]*\\)",
                "gi"
            );

            const value = field_label === "Length"
                ? length_value
                : (item[fieldname] || 0);

            formula = formula.replace(regex, value);

        }

        if (!/^[\d\s+\-*/().]*$/.test(formula)) {

            frappe.msgprint(
                __(
                    "Formula for item {0} contains an unresolved value: {1}",
                    [row.item_code, formula]
                )
            );

            return;
        }

        try {

            const qty_per_unit = Function(
                `"use strict"; return (${formula});`
            )();

            if (!isFinite(qty_per_unit) || qty_per_unit <= 0) {
                throw new Error("Invalid calculation");
            }

            const multiplier = has_fixed_length ? entered_qty : 1;
            const final_qty = multiplier * qty_per_unit;

            frappe.model.set_value(cdt, cdn, "qty", final_qty);
            frappe.model.set_value(cdt, cdn, "uom", item.purchase_uom);

            const stock_qty_value = item.stock_uom === "Nos"
                ? Math.round(entered_qty)
                : entered_qty;

            const conversion_factor = stock_qty_value / final_qty;

            setTimeout(() => {

                frappe.model.set_value(cdt, cdn, "conversion_factor", conversion_factor);

                frappe.model.set_value(cdt, cdn, "stock_qty", stock_qty_value);

                setTimeout(() => enforce_nos_rounding(frm, cdt, cdn), 0);

            }, 0);

        } catch (e) {

            frappe.msgprint(
                __("Invalid formula in Item master for {0}", [row.item_code])
            );

        }

    });

}

function enforce_nos_rounding(frm, cdt, cdn) {

    const row = locals[cdt][cdn];

    if (row.stock_uom !== "Nos") {
        return;
    }

    const rounded = Math.round(row.stock_qty);

    if (row.stock_qty !== rounded) {
        frappe.model.set_value(cdt, cdn, "stock_qty", rounded);
    }

}


function escape_regex(value) {

    return value.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );

}


function get_item(item_code) {

    if (item_cache[item_code]) {
        return Promise.resolve(item_cache[item_code]);
    }

    return frappe.db.get_doc(
        "Item",
        item_code
    ).then((item) => {

        item_cache[item_code] = item;

        return item;
    });

}


frappe.ui.form.on("Purchase Order", {
    refresh(frm) {
        if (frm.doc.docstatus !== 1) {
            return;
        }

        frm.remove_custom_button("Payment Request", "Create");

        frm.add_custom_button(
            __("Payment Request"),
            function () {
                show_payment_term_dialog(frm);
            },
            __("Create")
        );
    }
});


function show_payment_term_dialog(frm) {

    const payment_schedule = frm.doc.payment_schedule || [];

    if (!payment_schedule.length) {
        frappe.msgprint({
            title: __("No Payment Terms"),
            message: __("No payment terms are available in this Purchase Order."),
            indicator: "orange"
        });

        return;
    }

    // Only terms available in this PO
    const payment_terms = payment_schedule
        .filter(row => row.payment_term)
        .map(row => row.payment_term);

    if (!payment_terms.length) {
        frappe.msgprint({
            title: __("No Payment Terms"),
            message: __("No payment terms are available in this Purchase Order."),
            indicator: "orange"
        });

        return;
    }

    const dialog = new frappe.ui.Dialog({
        title: __("Create Payment Request"),

        fields: [
            {
                fieldname: "payment_term",
                fieldtype: "Select",
                label: __("Payment Term"),
                options: payment_terms.join("\n"),
                reqd: 1
            }
        ],

        primary_action_label: __("Create Payment Request"),

        primary_action(values) {

            if (!values.payment_term) {
                frappe.msgprint(__("Please select a Payment Term."));
                return;
            }

            dialog.hide();

            frappe.call({
                method: "nmtg.override.payment_request.create_po_payment_request",

                args: {
                    po: frm.doc.name,
                    payment_term: values.payment_term
                },

                freeze: true,

                freeze_message: __("Creating Payment Request..."),

                callback: function (r) {

                    if (!r.message) {
                        return;
                    }

                    frappe.show_alert({
                        message: __("Payment Request {0} created", [r.message]),
                        indicator: "green"
                    });

                    frappe.set_route("Form", "Payment Request", r.message);
                }
            });
        }
    });

    dialog.show();
}