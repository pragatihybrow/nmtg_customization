// // Copyright (c) 2026, Hybrowlabs and contributors
// // For license information, please see license.txt

// frappe.ui.form.on("Item Settings CT", {
//     form_render: function (frm, cdt, cdn) {
//         render_required_fields_multiselect(frm, cdt, cdn);
//     }
// });

// function render_required_fields_multiselect(frm, cdt, cdn) {
//     let row = locals[cdt][cdn];

//     let grid_row = frm.open_grid_row();
//     if (!grid_row || !grid_row.grid_form || !grid_row.grid_form.fields_dict.required_fields) {
//         return;
//     }

//     let $wrapper = $(grid_row.grid_form.fields_dict.required_fields.wrapper);
//     $wrapper.empty();

//     const skip_fields = [
//         "custom_product_group",
//         "custom_product_group_initials",
//         "custom_sub_product_group",
//         "custom_product_code",
//         "custom_models",
//         "custom_material_type",
//         "custom_material_sub_type",
//         "custom_section_break_0x4t9",
//         "custom_section_break_qnbdu",
//         "gst_hsn_code",
//         "is_ineligible_for_itc",
//         "custom_quality_inspection_percent",
//         "custom_column_break_uehck",
//         "custom_drawing",
//         "custom_tds_attachment",
//         "custom_formula_for_conversion",
//         "custom_only_internal_qc",
//         "custom_create_nmtg_code"
//     ];

//     frappe.call({
//         method: "frappe.client.get_list",
//         args: {
//             doctype: "Custom Field",
//             filters: { dt: "Item" },
//             fields: ["fieldname", "label"],
//             limit_page_length: 0,
//             order_by: "idx asc"
//         },
//         callback: function (r) {
//             let custom_fields = (r.message || []).filter(
//                 f => !skip_fields.includes(f.fieldname)
//             );

//             let options = custom_fields.map(f => ({
//                 value: f.fieldname,
//                 label: `${f.label || f.fieldname} (${f.fieldname})`
//             }));

//             let control = frappe.ui.form.make_control({
//                 parent: $wrapper,
//                 df: {
//                     fieldtype: "MultiSelectPills",
//                     label: "Select Required Fields",
//                     fieldname: "required_fields_select",
//                     options: options
//                 },
//                 render_input: true
//             });

//             // Set old values
//             if (row.feilds) {
//                 let saved_fieldnames = row.feilds
//                     .split(",")
//                     .map(x => x.trim())
//                     .filter(Boolean);
//                 control.set_value(saved_fieldnames);
//             }

//             // ✅ MutationObserver — watches pill DOM, fires on both add AND remove
//             const pills_container = $wrapper[0];
//             const observer = new MutationObserver(function () {
//                 let selected = control.get_value() || [];
//                 frappe.model.set_value(cdt, cdn, "feilds", selected.join(","));
//             });

//             observer.observe(pills_container, {
//                 childList: true,
//                 subtree: true
//             });
//         }
//     });
// }


// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

const ITEM_SETTINGS_SKIP_FIELDS = [
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
    "custom_create_nmtg_code"
];

const ITEM_SETTINGS_STANDARD_TOKENS = [
    { value: "item_group", label: "Item Group" },
    { value: "custom_product_group", label: "Product Group" },
    { value: "custom_product_group_initials", label: "Product Group Initials" },
    { value: "custom_sub_product_group", label: "Sub Product Group" },
    { value: "custom_product_code", label: "Product Code" },
    { value: "stock_uom", label: "UOM" }
];

// Cached so the server isn't hit on every grid row render
let _item_custom_fields_cache = null;

function get_item_custom_fields(callback) {
    if (_item_custom_fields_cache) {
        callback(_item_custom_fields_cache);
        return;
    }
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
            _item_custom_fields_cache = r.message || [];
            callback(_item_custom_fields_cache);
        }
    });
}

frappe.ui.form.on("Item Settings CT", {
    form_render: function (frm, cdt, cdn) {
        render_required_fields_multiselect(frm, cdt, cdn);
        render_pattern_helper(frm, cdt, cdn, "name_pattern");
        render_pattern_helper(frm, cdt, cdn, "code_pattern");
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

    get_item_custom_fields(function (all_fields) {
        let custom_fields = all_fields.filter(
            f => !ITEM_SETTINGS_SKIP_FIELDS.includes(f.fieldname)
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

        if (row.feilds) {
            let saved_fieldnames = row.feilds
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);
            control.set_value(saved_fieldnames);
        }

        const pills_container = $wrapper[0];
        const observer = new MutationObserver(function () {
            let selected = control.get_value() || [];
            frappe.model.set_value(cdt, cdn, "feilds", selected.join(","));
        });

        observer.observe(pills_container, {
            childList: true,
            subtree: true
        });
    });
}

function render_pattern_helper(frm, cdt, cdn, target_fieldname) {
    let grid_row = frm.open_grid_row();
    if (!grid_row || !grid_row.grid_form || !grid_row.grid_form.fields_dict[target_fieldname]) {
        return;
    }

    let field_obj = grid_row.grid_form.fields_dict[target_fieldname];
    let $field_wrapper = $(field_obj.wrapper);
    let $input = field_obj.$input;

    // Avoid stacking duplicates on repeated form_render calls
    $field_wrapper.find(`.pattern-helper-${target_fieldname}`).remove();

    let $helper = $(`
        <div class="pattern-helper-${target_fieldname}" style="margin-top: 4px;">
            <a href="#" class="pattern-helper-toggle" style="font-size: 11px; font-weight: 600;">
                <span class="toggle-icon">▸</span> Insert Field
            </a>
            <div class="pattern-helper-body" style="display:none; margin-top: 6px; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--control-bg);">
                <div class="pattern-token-bar" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;"></div>
                <div class="pattern-preview text-muted" style="font-size: 12px;"></div>
            </div>
        </div>
    `);

    $field_wrapper.append($helper);

    let $toggle = $helper.find(".pattern-helper-toggle");
    let $body = $helper.find(".pattern-helper-body");
    let $icon = $helper.find(".toggle-icon");
    let $token_bar = $helper.find(".pattern-token-bar");
    let $preview = $helper.find(".pattern-preview");

    $toggle.on("click", function (e) {
        e.preventDefault();
        let is_open = $body.is(":visible");
        $body.slideToggle(150);
        $icon.text(is_open ? "▸" : "▾");
    });

    get_item_custom_fields(function (all_fields) {
        let custom_tokens = all_fields
            .filter(f => !ITEM_SETTINGS_SKIP_FIELDS.includes(f.fieldname))
            .map(f => ({ value: f.fieldname, label: f.label || f.fieldname }));

        let tokens = ITEM_SETTINGS_STANDARD_TOKENS.concat(custom_tokens);

        if (target_fieldname === "code_pattern") {
            tokens = tokens.concat([{ value: "sequence", label: "Sequence No." }]);
        }

        let token_label_map = {};
        tokens.forEach(t => { token_label_map[t.value] = t.label; });

        function update_preview() {
            let value = $input.val() || "";
            if (!value) {
                $preview.text("");
                return;
            }
            let rendered = value.replace(/\{([^}]+)\}/g, function (match, key) {
                if (key === "sequence") return "001";
                return token_label_map[key] ? `<${token_label_map[key]}>` : match;
            });
            $preview.text(`Preview: ${rendered}`);
        }

        tokens.forEach(function (token) {
            let $chip = $(`
                <button type="button" class="btn btn-xs btn-default"
                    style="padding: 1px 8px; border-radius: 10px;">
                    ${frappe.utils.escape_html(token.label)}
                </button>
            `);

            $chip.on("mousedown", function (e) {
                e.preventDefault();
            });

            $chip.on("click", function () {
                let cursor_pos = $input.data("last-cursor-pos");
                if (cursor_pos == null) cursor_pos = ($input.val() || "").length;

                let value = $input.val() || "";
                let placeholder = `{${token.value}}`;
                let new_value = value.slice(0, cursor_pos) + placeholder + value.slice(cursor_pos);

                $input.val(new_value);
                frappe.model.set_value(cdt, cdn, target_fieldname, new_value);

                let new_cursor_pos = cursor_pos + placeholder.length;
                $input[0].setSelectionRange(new_cursor_pos, new_cursor_pos);
                $input.data("last-cursor-pos", new_cursor_pos);
                $input.focus();

                update_preview();
            });

            $token_bar.append($chip);
        });

        $input.on("keyup click", function () {
            $(this).data("last-cursor-pos", this.selectionStart);
        });
        $input.on("keyup change", update_preview);

        update_preview();
    });
}