frappe.ui.form.on('Purchase Receipt Item', {
    form_render: function(frm, cdt, cdn) {
        render_qc_supplier_table(frm, cdt, cdn);
    }
});

frappe.ui.form.on("Purchase Receipt", {
    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.docstatus === 0 && frappe.model.can_create("Quality Inspection")) {
            setTimeout(() => {
                frm.remove_custom_button(__("Quality Inspection(s)"), __("Create"));
                frm.add_custom_button(__("Quality Inspection(s)"), function() {
                    custom_make_quality_inspection(frm);
                }, __("Create"));
            }, 100);
        }
    }
});


function render_qc_supplier_table(frm, cdt, cdn) {
    let d = locals[cdt][cdn];
    let row = frm.fields_dict['items'].grid.grid_rows_by_docname[cdn];
    if (!row) return;

    let wrapper = row.grid_form.fields_dict['custom_supplier_selection_for_qc'];
    if (!wrapper) return;

    let qc_rows = (frm.doc.custom_supplier_selection_for_qc || [])
        .filter(r => r.item === d.item_code);

    let html = `
        <style>
            .qc-table { width: 100%; font-size: 12px; }
            .qc-table th { background: #1e2235; color: #a0aec0; font-weight: 500; padding: 6px 10px; }
            .qc-table td { padding: 5px 10px; vertical-align: middle; }
            .qc-table tr:nth-child(even) { background: #f9f9f9; }
            .qc-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #363a50; color: #fff; font-size: 11px; }
            .qc-test-tag { display: inline-block; padding: 2px 7px; border-radius: 8px; background: #d4a843; color: #0f1117; font-size: 10px; font-weight: 600; margin: 2px 2px; }
        </style>
        <div style="margin: 8px 0;">
            <table class="table table-bordered qc-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Lab</th>
                        <th>Qty</th>
                        <th>NMTG Heat Number</th>
                        <th>Testing Type</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (!qc_rows.length) {
        html += `<tr><td colspan="5" style="text-align:center; color:#888; padding:10px;">No supplier QC entries for this item.</td></tr>`;
    } else {
        qc_rows.forEach((r, i) => {
            let testing_tags = '';
            try {
                let types = JSON.parse(r.testing_value || '[]');
                if (types.length) {
                    testing_tags = types.map(t =>
                        `<span class="qc-test-tag">${frappe.utils.escape_html(t)}</span>`
                    ).join('');
                } else {
                    testing_tags = `<span style="color:#888; font-size:11px;">—</span>`;
                }
            } catch(e) {
                testing_tags = `<span style="color:#888; font-size:11px;">—</span>`;
            }

            html += `
                <tr>
                    <td>${i + 1}</td>
                    <td><span class="qc-badge">${r.supplier || ''}</span></td>
                    <td>${r.qty || 0}</td>
                    <td>${r.nmtg_heat_number || ''}</td>
                    <td>${testing_tags}</td>
                </tr>`;
        });
    }

    html += `</tbody></table></div>`;
    $(wrapper.wrapper).html(html);
}


function custom_make_quality_inspection(frm) {
    let data = [];

    const fields = [
        {
            label: "Items",
            fieldtype: "Table",
            fieldname: "items",
            cannot_add_rows: true,
            cannot_delete_rows: true,
            in_place_edit: true,
            data: data,
            get_data: () => data,
            fields: [
                { fieldtype: "Data", fieldname: "docname",                  hidden: true },
                { fieldtype: "Data", fieldname: "child_row_reference",       hidden: true },
                { fieldtype: "Data", fieldname: "qc_row_name",              hidden: true },
                { fieldtype: "Data", fieldname: "supplier",                 hidden: true },
                { fieldtype: "Data", fieldname: "nmtg_heat_number",          hidden: true },
                { fieldtype: "Data", fieldname: "custom_vendor_heat_number", hidden: true },
                { fieldtype: "Data", fieldname: "custom_mill_tc",            hidden: true },
                { fieldtype: "Data", fieldname: "testing_value",             hidden: true },
                {
                    fieldtype: "Read Only", fieldname: "item_code",
                    label: __("Item Code"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Read Only", fieldname: "item_name",
                    label: __("Item Name"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Read Only", fieldname: "supplier_display",
                    label: __("Lab"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Read Only", fieldname: "nmtg_heat_number_display",
                    label: __("NMTG Heat Number"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Float", fieldname: "qty",
                    label: __("Qty"), in_list_view: true, read_only: true, columns: 1,
                },
                {
                    fieldtype: "Float", fieldname: "sample_size",
                    label: __("Sample Size"), reqd: true, in_list_view: true, columns: 1,
                },
                {
                    fieldtype: "Read Only", fieldname: "testing_type_display",
                    label: __("Testing Type"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Read Only", fieldname: "duplicate_label",
                    label: __("Status"), in_list_view: true, columns: 2,
                },
            ],
        },
    ];

    const dialog = new frappe.ui.Dialog({
        title: __("Select Items for Quality Inspection"),
        size: "extra-large",
        fields: fields,
        primary_action_label: __("Create"),
        primary_action: function() {
            const values = dialog.get_values();
            const selected = (values.items || []).filter(r => r.__checked == 1);

            if (!selected.length) {
                frappe.msgprint(__("Please select at least one row."));
                return;
            }

            const has_dup = selected.some(r => {
                const key = `${r.item_code}||${r.supplier || ""}||${r.nmtg_heat_number || ""}`;
                return duplicate_keys.has(key);
            });
            if (has_dup) {
                frappe.msgprint(__("One or more selected rows already have a Quality Inspection. Please deselect them."));
                return;
            }

            frappe.call({
                method: "nmtg.override.api.make_quality_inspections_custom",
                args: {
                    company: frm.doc.company,
                    doctype: frm.doc.doctype,
                    docname: frm.doc.name,
                    inspection_type: "Incoming",
                    items: selected.map(r => ({
                        item_code:                 r.item_code,
                        item_name:                 r.item_name,
                        qty:                       r.qty,
                        sample_size:               r.sample_size,
                        child_row_reference:       r.child_row_reference,
                        supplier:                  r.supplier,
                        nmtg_heat_number:          r.nmtg_heat_number,
                        custom_vendor_heat_number: r.custom_vendor_heat_number,
                        custom_mill_tc:            r.custom_mill_tc,
                        testing_value:             r.testing_value || '[]',
                    })),
                },
                freeze: true,
                callback: function(r) {
                    if (r.message && r.message.length > 0) {
                        if (r.message.length === 1) {
                            frappe.set_route("Form", "Quality Inspection", r.message[0]);
                        } else {
                            frappe.route_options = {
                                reference_type: frm.doc.doctype,
                                reference_name: frm.doc.name,
                            };
                            frappe.set_route("List", "Quality Inspection");
                        }
                    }
                    dialog.hide();
                    frm.reload_doc();
                }
            });
        }
    });

    const duplicate_keys = new Set();

    const item_map = {};
    (frm.doc.items || []).forEach(item => {
        item_map[item.item_code] = item;
    });

    let grid_field = dialog.fields_dict.items;

    (frm.doc.custom_supplier_selection_for_qc || []).forEach(qc => {
        const parent_item = item_map[qc.item];
        if (!parent_item) return;

        let testing_type_display = '';
        try {
            let types = JSON.parse(qc.testing_value || '[]');
            testing_type_display = types.join(', ') || '—';
        } catch(e) {
            testing_type_display = '—';
        }

        grid_field.df.data.push({
            docname:                   parent_item.name,
            item_code:                 qc.item,
            item_name:                 parent_item.item_name,
            supplier:                  qc.supplier,
            nmtg_heat_number:          qc.nmtg_heat_number,
            custom_vendor_heat_number: parent_item.custom_vendor_heat_number || "",
            custom_mill_tc:            parent_item.custom_mill_tc || "",
            supplier_display:          qc.supplier,
            nmtg_heat_number_display:  qc.nmtg_heat_number,
            qty:                       qc.qty,
            sample_size:               0,
            child_row_reference:       parent_item.name,
            qc_row_name:               qc.name,
            testing_value:             qc.testing_value || '[]',
            testing_type_display:      testing_type_display,
            duplicate_label:           __("Checking…"),
        });
    });

    if (!grid_field.df.data.length) {
        frappe.msgprint(__("No supplier QC entries found."));
        return;
    }

    grid_field.grid.refresh();
    dialog.show();

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Quality Inspection",
            filters: {
                reference_type: frm.doc.doctype,
                reference_name: frm.doc.name,
                docstatus: ["!=", 2],
            },
            fields: ["name", "item_code", "custom_supplier", "custom_nmtg_heat_number"],
            limit_page_length: 500,
        },
        callback: function(res) {
            const existing = res.message || [];

            existing.forEach(qi => {
                duplicate_keys.add(
                    `${qi.item_code}||${qi.custom_supplier || ""}||${qi.custom_nmtg_heat_number || ""}`
                );
            });

            const duplicate_cdns = new Set();

            grid_field.df.data.forEach(row => {
                const key = `${row.item_code}||${row.supplier || ""}||${row.nmtg_heat_number || ""}`;
                if (duplicate_keys.has(key)) {
                    row.duplicate_label = __("⚠ QI Exists");
                    duplicate_cdns.add(row.name);
                } else {
                    row.duplicate_label = __("✔ New");
                }
            });

            grid_field.grid.refresh();

            setTimeout(() => {
                apply_duplicate_row_styles(grid_field, duplicate_keys);
            }, 150);

            grid_field.grid.wrapper.on("change", ".grid-heading-row .select-like input", function() {
                setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_keys), 50);
            });
        }
    });
}



// ── Walk every rendered grid row, match by data, disable duplicates ───────────
function apply_duplicate_row_styles(grid_field, duplicate_keys) {
    grid_field.grid.wrapper.find(".grid-row").each(function() {
        const $row = $(this);
        const cdn  = $row.attr("data-name");
        if (!cdn) return;

        // Find the data row by cdn (Frappe sets row.name = cdn)
        const row_data = grid_field.df.data.find(r => r.name === cdn);
        if (!row_data) return;

        const key = `${row_data.item_code}||${row_data.supplier || ""}||${row_data.nmtg_heat_number || ""}`;
        if (!duplicate_keys.has(key)) return;

        // Uncheck + disable the checkbox
        const $cb = $row.find(".row-check input[type='checkbox']");
        $cb.prop("checked", false).prop("disabled", true);

        // Grey out the entire row
        $row.css({ "opacity": "0.45", "pointer-events": "none" });

        // But keep the checkbox wrapper itself pointer-events: none already via row
    });

    // Intercept header "select all" — uncheck and re-disable duplicates
    grid_field.grid.wrapper.off("change.dup_guard").on("change.dup_guard",
        ".grid-heading-row input[type='checkbox']", function() {
            setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_keys), 30);
        }
    );
}