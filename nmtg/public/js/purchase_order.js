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


// function calculate_formula(frm, cdt, cdn) {

//     const row = locals[cdt][cdn];

//     if (!row.item_code || !row.custom_quantity_in_mm) {
//         return;
//     }

//     get_item(row.item_code).then((item) => {

//         if (!item) {
//             return;
//         }

//         const entered_qty = flt(row.custom_quantity_in_mm);

//         // Only run the conversion formula when purchase_uom and stock_uom
//         // actually differ — that's the only case where a conversion_factor
//         // needs computing. If they're the same, qty is just whatever was
//         // entered — no formula, no conversion_factor games.
//         if (item.purchase_uom === item.stock_uom) {

//             const qty_value = item.purchase_uom === "Nos"
//                 ? Math.round(entered_qty)
//                 : entered_qty;

//             frappe.model.set_value(cdt, cdn, "qty", qty_value);

//             if (item.purchase_uom) {
//                 frappe.model.set_value(cdt, cdn, "uom", item.purchase_uom);
//             }

//             return;
//         }

//         if (!item.custom_formula_for_conversion) {
//             return;
//         }

//         // If the Item master has no fixed Length, treat the entered value
//         // as the Length itself (e.g. bar stock cut to order), not as a
//         // piece-count multiplier.
//         const has_fixed_length = flt(item.custom_length) > 0;
//         const length_value = has_fixed_length ? item.custom_length : entered_qty;

//         let formula = item.custom_formula_for_conversion;

//         for (const [field_label, fieldname] of Object.entries(FORMULA_FIELD_MAP)) {

//             const regex = new RegExp(
//                 escape_regex(field_label) + "\\s*\\([^)]*\\)",
//                 "gi"
//             );

//             const value = field_label === "Length"
//                 ? length_value
//                 : (item[fieldname] || 0);

//             formula = formula.replace(regex, value);

//         }

//         if (!/^[\d\s+\-*/().]*$/.test(formula)) {

//             frappe.msgprint(
//                 __(
//                     "Formula for item {0} contains an unresolved value: {1}",
//                     [row.item_code, formula]
//                 )
//             );

//             return;
//         }

//         try {

//             /*
//              * qty_per_unit:
//              * - If item has a fixed Length: weight/quantity of ONE piece,
//              *   in purchase_uom
//              * - If Length comes from the row: total weight/quantity for
//              *   that entered length, in purchase_uom (already
//              *   length-specific)
//              */
//             const qty_per_unit = Function(
//                 `"use strict"; return (${formula});`
//             )();

//             if (!isFinite(qty_per_unit) || qty_per_unit <= 0) {
//                 throw new Error("Invalid calculation");
//             }

//             // Piece-count multiplier only applies when Length is fixed on
//             // the Item master; otherwise entered_qty was already consumed
//             // as the Length in the formula above.
//             const multiplier = has_fixed_length ? entered_qty : 1;
//             const final_qty = multiplier * qty_per_unit;

//             // qty is in purchase_uom here (never Nos, since we already
//             // returned above when purchase_uom === stock_uom), so no
//             // rounding needed at this point.
//             frappe.model.set_value(cdt, cdn, "qty", final_qty);
//             frappe.model.set_value(cdt, cdn, "uom", item.purchase_uom);

//             // stock_qty is expressed in stock_uom, so round it when
//             // stock_uom is Nos (whole pieces only).
//             const stock_qty_value = item.stock_uom === "Nos"
//                 ? Math.round(entered_qty)
//                 : entered_qty;

//             // conversion_factor = stock_qty / qty, using the
//             // (possibly rounded) stock_qty to keep the two consistent.
//             const conversion_factor = stock_qty_value / final_qty;

//             setTimeout(() => {

//                 frappe.model.set_value(
//                     cdt,
//                     cdn,
//                     "conversion_factor",
//                     conversion_factor
//                 );

//                 frappe.model.set_value(
//                     cdt,
//                     cdn,
//                     "stock_qty",
//                     stock_qty_value
//                 );

//                 // Belt-and-braces: re-round after core's own
//                 // recalculation (triggered by the conversion_factor
//                 // set above) has had a chance to reintroduce drift
//                 // due to conversion_factor precision rounding.
//                 setTimeout(() => enforce_nos_rounding(frm, cdt, cdn), 0);

//             }, 0);

//         } catch (e) {

//             frappe.msgprint(
//                 __(
//                     "Invalid formula in Item master for {0}",
//                     [row.item_code]
//                 )
//             );

//         }

//     });

// }


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

        // Only run the conversion formula when purchase_uom and stock_uom
        // actually differ — that's the only case where a conversion_factor
        // needs computing. If they're the same, qty is just whatever was
        // entered — no formula, no conversion_factor games.
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

        // If the Item master has no fixed Length, treat the entered value
        // as the Length itself (e.g. bar stock cut to order), not as a
        // piece-count multiplier.
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

            /*
             * qty_per_unit:
             * - If item has a fixed Length: weight/quantity of ONE piece,
             *   in purchase_uom
             * - If Length comes from the row: total weight/quantity for
             *   that entered length, in purchase_uom (already
             *   length-specific)
             */
            const qty_per_unit = Function(
                `"use strict"; return (${formula});`
            )();

            if (!isFinite(qty_per_unit) || qty_per_unit <= 0) {
                throw new Error("Invalid calculation");
            }

            // Piece-count multiplier only applies when Length is fixed on
            // the Item master; otherwise entered_qty was already consumed
            // as the Length in the formula above.
            const multiplier = has_fixed_length ? entered_qty : 1;
            const final_qty = multiplier * qty_per_unit;

            // qty is in purchase_uom here (never Nos, since we already
            // returned above when purchase_uom === stock_uom), so no
            // rounding needed at this point.
            frappe.model.set_value(cdt, cdn, "qty", final_qty);
            frappe.model.set_value(cdt, cdn, "uom", item.purchase_uom);

            // stock_qty is expressed in stock_uom, so round it when
            // stock_uom is Nos (whole pieces only).
            const stock_qty_value = item.stock_uom === "Nos"
                ? Math.round(entered_qty)
                : entered_qty;

            // conversion_factor = stock_qty / qty, using the
            // (possibly rounded) stock_qty to keep the two consistent.
            const conversion_factor = stock_qty_value / final_qty;

            setTimeout(() => {

                frappe.model.set_value(
                    cdt,
                    cdn,
                    "conversion_factor",
                    conversion_factor
                );

                frappe.model.set_value(
                    cdt,
                    cdn,
                    "stock_qty",
                    stock_qty_value
                );

                // Belt-and-braces: re-round after core's own
                // recalculation (triggered by the conversion_factor
                // set above) has had a chance to reintroduce drift
                // due to conversion_factor precision rounding.
                setTimeout(() => enforce_nos_rounding(frm, cdt, cdn), 0);

            }, 0);

        } catch (e) {

            frappe.msgprint(
                __(
                    "Invalid formula in Item master for {0}",
                    [row.item_code]
                )
            );

        }

    });

}

function enforce_nos_rounding(frm, cdt, cdn) {

    const row = locals[cdt][cdn];

    // stock_uom is already present on the row itself (fetched from Item
    // when item_code is set), no need to re-fetch the Item doc here.
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