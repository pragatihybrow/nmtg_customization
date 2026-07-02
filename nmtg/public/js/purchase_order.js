const item_cache = {};

frappe.ui.form.on("Purchase Order", {
    refresh(frm) {
        recalculate_all_item_qtys(frm);
    },

    before_save(frm) {
        return recalculate_all_item_qtys(frm);
    },

    items_add(frm, cdt, cdn) {
        calculate_formula(frm, cdt, cdn);
    }
});

frappe.ui.form.on("Purchase Order Item", {
    item_code(frm, cdt, cdn) {
        frappe.after_ajax(() => {
            calculate_formula(frm, cdt, cdn);
        });
    },

    custom_quantity_in_mm: frappe.utils.debounce((frm, cdt, cdn) => {
        calculate_formula(frm, cdt, cdn);
    }, 400)
});

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

function recalculate_all_item_qtys(frm) {
    let promises = (frm.doc.items || [])
        .filter(row => row.item_code && row.custom_quantity_in_mm)
        .map(row => calculate_formula(frm, row.doctype, row.name));

    return Promise.all(promises).then(() => {
        frm.refresh_field("items");
        frm.trigger("calculate_taxes_and_totals");
    });
}

function calculate_formula(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!row.item_code || !row.custom_quantity_in_mm) {
        return Promise.resolve();
    }

    return get_item(row.item_code).then(item => {
        if (!item || !item.custom_formula_for_conversion) {
            return;
        }

        let formula = item.custom_formula_for_conversion;

        // Replace Length
        formula = replace_token(
            formula,
            "Length(mm)",
            flt(row.custom_quantity_in_mm)
        );

        // Replace all other formula tokens
        Object.entries(FORMULA_FIELD_MAP).forEach(([token, fieldname]) => {
            formula = replace_token(
                formula,
                token,
                flt(item[fieldname] || 0)
            );
        });

        // Validate formula
        if (!/^[\d\s+\-*/().]*$/.test(formula)) {
            frappe.throw(
                __("Unresolved formula for Item {0}: {1}", [row.item_code, formula])
            );
        }

        try {
            let qty = Function(`"use strict"; return (${formula})`)();

            if (!isFinite(qty)) {
                frappe.throw(__("Invalid calculated quantity"));
            }

            qty = flt(qty, 3);

            return frappe.model.set_value(cdt, cdn, "qty", qty);
        } catch (e) {
            frappe.throw(
                __("Invalid formula in Item master for {0}", [row.item_code])
            );
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

    return frappe.db.get_doc("Item", item_code).then(item => {
        item_cache[item_code] = item;
        return item;
    });
}