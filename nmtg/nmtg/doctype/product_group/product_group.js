// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

let _item_meta_fields_cache = null;

const ITEM_MULTISELECT_SKIP_FIELDTYPES = [
    "Section Break", "Column Break", "Tab Break", "HTML",
    "Button", "Table", "Table MultiSelect", "Fold", "Heading"
];

const ITEM_MULTISELECT_SKIP_FIELDS = [
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
    "custom_only_internal_qc",
    "custom_create_nmtg_code",
    "custom_legacy_item_name",
    "custom_quality_category_required"
];

function get_item_all_fields(callback) {
    if (_item_meta_fields_cache) {
        callback(_item_meta_fields_cache);
        return;
    }
    frappe.model.with_doctype("Item", function () {
        let meta = frappe.get_meta("Item");
        let fields = meta.fields.filter(
            f => f.fieldname
                && f.fieldname.startsWith("custom_")
                && !ITEM_MULTISELECT_SKIP_FIELDTYPES.includes(f.fieldtype)
                && !ITEM_MULTISELECT_SKIP_FIELDS.includes(f.fieldname)
        );
        _item_meta_fields_cache = fields;
        callback(fields);
    });
}

frappe.ui.form.on("Product Group", {
    refresh: function (frm) {
        render_item_required_fields_multiselect(frm);
    }
});

function render_item_required_fields_multiselect(frm) {
    let field = frm.fields_dict.required_feilds;
    if (!field) return;

    let $wrapper = $(field.wrapper);
    $wrapper.empty();

    get_item_all_fields(function (all_fields) {
        let options = all_fields.map(f => ({
            value: f.fieldname,
            label: `${f.label || f.fieldname} (${f.fieldname})`
        }));

        let control = frappe.ui.form.make_control({
            parent: $wrapper,
            df: {
                fieldtype: "MultiSelectPills",
                label: "Select Required Fields",
                fieldname: "required_fields_select",
                options: options,
                read_only: frm.doc.docstatus === 1
            },
            render_input: true
        });
        control.refresh();

        if (frm.doc.required_fields_value) {
            let saved = frm.doc.required_fields_value
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);
            control.set_value(saved);
        }

        const observer = new MutationObserver(function () {
            let selected = control.get_value() || [];
            frm.set_value("required_fields_value", selected.join(","));
        });
        observer.observe($wrapper[0], { childList: true, subtree: true });
    });
}