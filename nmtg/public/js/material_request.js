frappe.ui.form.on('Material Request', {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            // Remove default Make RFQ button and replace with ours
            frm.remove_custom_button('Request for Quotation', 'Create');

            frm.add_custom_button(__('Request for Quotation'), function() {
                frappe.call({
                    method: 'nmtg.override.material_request.make_rfq_with_suppliers',
                    args: {
                        source_name: frm.doc.name
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.model.sync(r.message);
                            frappe.set_route(
                                'Form',
                                'Request for Quotation',
                                r.message.name
                            );
                        }
                    }
                });
            }, __('Create'));
        }
    }
});

frappe.ui.form.on("Material Request Item", {
    custom_quantity_in_mm: frappe.utils.debounce((frm, cdt, cdn) => calculate_formula(frm, cdt, cdn), 400),
    item_code(frm, cdt, cdn) {
        calculate_formula(frm, cdt, cdn);
    }
});

// Cache fetched item docs so we don't hit the server on every recalculation
const item_cache = {};

// Maps formula placeholders -> Item fieldname. Extend this list if you add
// more custom dimension fields to the Item doctype.
const FORMULA_FIELD_MAP = {
    "Diameter(mm)": "custom_diameter",
    "Width(mm)": "custom_width",
    "Height(mm)": "custom_height",
    "Thickness(mm)": "custom_thickness",
    "OD(mm)": "custom_od",
    "Pipe Size(mm)": "custom_pipe_size",
    "Spigot Diameter(mm)": "custom_spigot_diameter",
    "Groove(mm)": "custom_groove",
    "Drill(mm)": "custom_drill_value",
    "Deep(mm)": "custom_deep_value",
    "ID(mm)": "custom_id",
    "TL(mm)": "custom_tl",
    "Step(mm)": "custom_step",
    "Wired Length(mm)": "custom_wired_length",
    "Wired Diameter(mm)": "custom_wired_diameter",
    "Frame Value(mm)": "custom_frame_value",
    "Thread Size(mm)": "custom_thread_size",
    "No of Teeth": "custom_no_of_teeth",
    "Cross Sectional Width(mm)": "custom_cross_sectional_width",
    "Cross Sectional Thickness(mm)": "custom_cross_sectional_thickness",
    "Value of Pitch Diameter(mm)": "custom_value_of_pitch_diameter",
    "Value of Tooth Thickness(mm)": "custom_value_of_tooth_thickness",
    "Gap Between Spring And Coil(mm)": "custom_gap_between_spring_and_coil",
    "Value of Chain Pitch(mm)": "custom_value_of_chain_pitch"
};

function calculate_formula(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.item_code || !row.custom_quantity_in_mm) return;

    get_item(row.item_code).then((item) => {
        if (!item || !item.custom_formula_for_conversion) return;

        let formula = item.custom_formula_for_conversion;

        // Length comes from the row itself, not the Item master
        formula = replace_token(formula, "Length(mm)", row.custom_quantity_in_mm);

        for (const [token, fieldname] of Object.entries(FORMULA_FIELD_MAP)) {
            formula = replace_token(formula, token, item[fieldname] || 0);
        }

        // Safety check: after substitution only numbers/operators/whitespace
        // should remain. If anything else is left (e.g. an unmapped token),
        // bail out instead of eval-ing garbage.
        if (!/^[\d\s+\-*/().]*$/.test(formula)) {
            frappe.msgprint(
                __("Formula for item {0} contains a term that couldn't be resolved: {1}",
                    [row.item_code, formula])
            );
            return;
        }

        try {
            // eslint-disable-next-line no-new-func
            let qty = Function(`"use strict"; return (${formula});`)();
            if (!isFinite(qty)) throw new Error("Non-finite result");
            frappe.model.set_value(cdt, cdn, "qty", qty);
        } catch (e) {
            frappe.msgprint(__("Invalid formula in Item master for {0}", [row.item_code]));
        }
    });
}

function replace_token(str, token, value) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return str.replace(new RegExp(escaped, "g"), value);
}

function get_item(item_code) {
    if (item_cache[item_code]) {
        return Promise.resolve(item_cache[item_code]);
    }
    return frappe.db.get_doc("Item", item_code).then((item) => {
        item_cache[item_code] = item;
        return item;
    });
}