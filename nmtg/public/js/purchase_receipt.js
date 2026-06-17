frappe.ui.form.on('Purchase Receipt Item', {
    form_render: function(frm, cdt, cdn) {
        render_qc_supplier_table(frm, cdt, cdn);
    },
    custom_create_heat_number(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!row.custom_qty_in_no || row.custom_qty_in_no <= 0) {  // ✅ was row.qty
        frappe.msgprint("Please set a valid Qty In No before generating Heat Number.");
        return;
    }

    frappe.call({
        method: "nmtg.override.api.create_heat_number",
        args: {
            po: frm.doc.name,
            row_name: row.name
        },
        callback(r) {
            if (r.message) {
                locals[cdt][cdn].custom_nmtg_heat_number = r.message;
                frm.refresh_field("items");

                (frm.doc.custom_supplier_selection_for_qc || []).forEach(qc => {
                    if (qc.item === row.item_code) {
                        frappe.model.set_value(
                            "Supplier Selection For QC",
                            qc.name,
                            "nmtg_heat_number",
                            r.message
                        );
                    }
                });
                frm.refresh_field("custom_supplier_selection_for_qc");
            }
        }
    });
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
    },
     setup(frm) {
        frm.fields_dict.custom_supplier_selection_for_qc.grid.get_field("item").get_query =
            function(doc, cdt, cdn) {
                // Only show items that exist in the items child table
                let item_list = (doc.items || []).map(row => row.item_code).filter(Boolean);

                return {
                    filters: {
                        name: ["in", item_list.length ? item_list : [""]]
                    }
                };
            };
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

    // ── Collect unique item codes to fetch custom_quality_inspection_percent ──
    const unique_item_codes = [
        ...new Set(
            (frm.doc.custom_supplier_selection_for_qc || []).map(qc => qc.item).filter(Boolean)
        )
    ];

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Item",
            filters: [["item_code", "in", unique_item_codes]],
            fields: ["item_code", "custom_quality_inspection_percent"],
            limit_page_length: unique_item_codes.length || 1,
        },
        callback: function(res) {
            // Build a map: item_code → inspection_percent
            const qc_percent_map = {};
            (res.message || []).forEach(item => {
                qc_percent_map[item.item_code] = flt(item.custom_quality_inspection_percent) || 0;
            });

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

                // ── Sample size = ceil(qty * percent / 100), minimum 1 ──
                const percent = qc_percent_map[qc.item] || 0;
                const qty = flt(qc.qty) || 0;
                const sample_size = percent > 0 ? Math.ceil(qty * percent / 100) : 0;

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
                    qty:                       qty,
                    sample_size:               sample_size,
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

            // ── Check for existing QIs ──
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

                    grid_field.df.data.forEach(row => {
                        const key = `${row.item_code}||${row.supplier || ""}||${row.nmtg_heat_number || ""}`;
                        if (duplicate_keys.has(key)) {
                            row.duplicate_label = __("⚠ QI Exists");
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
    });
}


// ── Walk every rendered grid row, match by data, disable duplicates ───────────
function apply_duplicate_row_styles(grid_field, duplicate_keys) {
    grid_field.grid.wrapper.find(".grid-row").each(function() {
        const $row = $(this);
        const cdn  = $row.attr("data-name");
        if (!cdn) return;

        const row_data = grid_field.df.data.find(r => r.name === cdn);
        if (!row_data) return;

        const key = `${row_data.item_code}||${row_data.supplier || ""}||${row_data.nmtg_heat_number || ""}`;
        if (!duplicate_keys.has(key)) return;

        const $cb = $row.find(".row-check input[type='checkbox']");
        $cb.prop("checked", false).prop("disabled", true);

        $row.css({ "opacity": "0.45", "pointer-events": "none" });
    });

    grid_field.grid.wrapper.off("change.dup_guard").on("change.dup_guard",
        ".grid-heading-row input[type='checkbox']", function() {
            setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_keys), 30);
        }
    );
}

frappe.ui.form.on("Supplier Selection For QC", {
    item(frm, cdt, cdn) {
        frappe.model.set_value(cdt, cdn, "qty", 0);
    },

    form_render: function(frm, cdt, cdn) {
        render_testing_type_checkboxes(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.item || !row.qty) return;

        // Use custom_qty_in_no if available, else fall back to qty
        let total_qty = 0;
        (frm.doc.items || []).forEach(d => {
            if (d.item_code === row.item) {
                total_qty += flt(d.custom_qty_in_no || d.qty);  // ✅
            }
        });

        let qc_qty = 0;
        (frm.doc.custom_supplier_selection_for_qc || []).forEach(d => {
            if (d.item === row.item && d.name !== row.name) {
                qc_qty += flt(d.qty);
            }
        });

        let remaining = total_qty - qc_qty;

        if (flt(row.qty) > remaining) {
            frappe.msgprint(
                `<b>${row.item}</b>: Only <b>${remaining}</b> qty remaining to allocate ` +
                `(Total: ${total_qty}, already allocated in other rows: ${qc_qty}).`
            );
            frappe.model.set_value(cdt, cdn, "qty", 0);
        }
    }
});


function render_testing_type_checkboxes(frm, cdt, cdn) {
    let grid_row = frm.fields_dict['custom_supplier_selection_for_qc'].grid.get_row(cdn);
    if (!grid_row) return;
    let wrapper = grid_row.get_field('testing_type').wrapper;

    $(wrapper).empty();

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'QC Testing Type',
            fields: ['testing_type'],
            limit_page_length: 0
        },
        callback: function(r) {
            if (!r.message) return;

            let current_row = locals[cdt][cdn];
            let selected = [];
            try {
                selected = JSON.parse(current_row.testing_value || '[]');
            } catch(e) {
                selected = [];
            }

            let container = $(`
                <div class="jrq-testing-type-wrap" style="
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px 14px;
                    padding: 4px 0;
                "></div>
            `);

            r.message.forEach(function(doc) {
                let val = (doc.testing_type || '').trim();
                if (!val) return;

                let cb = $(`
                    <label style="
                        display: flex;
                        align-items: center;
                        gap: 5px;
                        font-size: 12px;
                        cursor: pointer;
                        white-space: nowrap;
                        user-select: none;
                    ">
                        <input type="checkbox" value="${frappe.utils.escape_html(val)}"
                            style="cursor:pointer; width:14px; height:14px;"
                        />
                        ${frappe.utils.escape_html(val)}
                    </label>
                `);

                cb.find('input').prop('checked', selected.includes(val));

                cb.find('input').on('change', function(e) {
                    e.stopPropagation();

                    let current = [];
                    $(wrapper).find('input[type=checkbox]:checked').each(function() {
                        current.push($(this).val());
                    });

                    let val_str = JSON.stringify(current);

                    // update locals and frm.doc
                    locals[cdt][cdn].testing_value = val_str;
                    let doc_row = (frm.doc.custom_supplier_selection_for_qc || [])
                        .find(d => d.name === cdn);
                    if (doc_row) doc_row.testing_value = val_str;

                    // persist directly to DB
                    frappe.call({
                        method: 'nmtg.override.api.update_qc_testing_type',
                        args: {
                            row_name: cdn,
                            testing_value: val_str
                        },
                        error: function() {
                            frappe.msgprint('Failed to save testing type.');
                        }
                    });
                });

                container.append(cb);
            });

            $(wrapper).append(container);
        }
    });
}