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
        const is_projection_mr =
            frm.doc.material_request_type === "Manufacture" &&
            frm.doc.custom_projection_order;

        if (!is_projection_mr) return;

        setTimeout(() => {
            frm.remove_custom_button("Work Order", "Create");
            frm.remove_custom_button(__("Work Order"), __("Create"));
        }, 300);

        if (frm.doc.docstatus === 1 && frm.doc.status !== "Stopped") {
            setTimeout(() => {
                frm.remove_custom_button("Production Plan", "Create"); 
                frm.add_custom_button(
                    __("Production Plan"),
                    () => make_production_plan(frm),
                    __("Create")
                );
            }, 350);
        }
    },
    before_workflow_action: function (frm) {
        if (frm.selected_workflow_action !== 'Reject') {
            return;
        }

        frappe.dom.unfreeze();

        return new Promise((resolve, reject) => {
            let submitted = false;

            const d = new frappe.ui.Dialog({
                title: __('Reason for Rejection'),
                fields: [
                    {
                        fieldname: 'custom_rejection_remark',
                        fieldtype: 'Small Text',
                        label: __('Rejection Remark'),
                        reqd: 1
                    }
                ],
                primary_action_label: __('Submit Rejection'),
                primary_action: function (values) {
                    submitted = true;
                    d.disable_primary_action();

                    frappe.call({
                        method: 'nmtg.override.api.custom_set_rejection_remark',
                        args: {
                            doctype: frm.doctype,
                            name: frm.docname,
                            remark: values.custom_rejection_remark
                        },
                        callback: function () {
                            d.hide();
                            resolve();
                        },
                        error: function () {
                            d.hide();
                            reject();
                        }
                    });
                }
            });

            d.$wrapper.on('hidden.bs.modal', () => {
                if (!submitted) {
                    frappe.show_alert({
                        message: __('Rejection cancelled — remark is required'),
                        indicator: 'orange'
                    });
                    reject();
                }
            });

            d.show();
        });
    }
});


frappe.ui.form.on("Material Request Item", {

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

function make_production_plan(frm) {
    frappe.model.with_doctype("Production Plan", () => {
        const pp = frappe.model.get_new_doc("Production Plan");
        pp.company = frm.doc.company;
        pp.get_items_from = "Material Request";

        const row = frappe.model.add_child(pp, "Production Plan Material Request", "material_requests");
        row.material_request = frm.doc.name;
        row.material_request_date = frm.doc.transaction_date;

        frappe.set_route("Form", "Production Plan", pp.name);
    });
}