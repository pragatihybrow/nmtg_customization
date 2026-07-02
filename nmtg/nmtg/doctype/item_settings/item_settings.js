// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.ui.form.on("Item Settings CT", {
    form_render: function (frm, cdt, cdn) {
        render_required_fields_multiselect(frm, cdt, cdn);
    }
});

function render_required_fields_multiselect(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    let grid_row = frm.open_grid_row();
    if (!grid_row || !grid_row.grid_form || !grid_row.grid_form.fields_dict.required_fields) {
        return;
    }

    let $wrapper = $(grid_row.grid_form.fields_dict.required_fields.wrapper);
    $wrapper.empty();

    const skip_fields = [
        "custom_product_group",
        "custom_product_group_initials",
        "custom_sub_product_group",
        "custom_product_code",
        "custom_models",
        "custom_material_type",
        "custom_material_sub_type",
        "custom_section_break_0x4t9",
        "custom_section_break_qnbdu",
        "gst_hsn_code",
        "is_ineligible_for_itc",
        "custom_quality_inspection_percent",
        "custom_column_break_uehck",
        "custom_drawing",
        "custom_tds_attachment",
        "custom_formula_for_conversion",
        "custom_only_internal_qc"
    ];

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Custom Field",
            filters: { dt: "Item" },
            fields: ["fieldname", "label"],
            limit_page_length: 0,
            order_by: "idx asc"
        },
        callback: function (r) {
            let custom_fields = (r.message || []).filter(
                f => !skip_fields.includes(f.fieldname)
            );

            let options = custom_fields.map(f => ({
                value: f.fieldname,
                label: `${f.label || f.fieldname} (${f.fieldname})`
            }));

            let control = frappe.ui.form.make_control({
                parent: $wrapper,
                df: {
                    fieldtype: "MultiSelectPills",
                    label: "Select Required Fields",
                    fieldname: "required_fields_select",
                    options: options
                },
                render_input: true
            });

            // Set old values
            if (row.feilds) {
                let saved_fieldnames = row.feilds
                    .split(",")
                    .map(x => x.trim())
                    .filter(Boolean);
                control.set_value(saved_fieldnames);
            }

            // ✅ MutationObserver — watches pill DOM, fires on both add AND remove
            const pills_container = $wrapper[0];
            const observer = new MutationObserver(function () {
                let selected = control.get_value() || [];
                frappe.model.set_value(cdt, cdn, "feilds", selected.join(","));
            });

            observer.observe(pills_container, {
                childList: true,
                subtree: true
            });
        }
    });
}