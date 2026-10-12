// ── Heat number helpers ──────────────────────────────────────────────
function parse_heat_number(text) {
    const m = String(text || "").replace(/\n/g, " ").trim().match(/^NK\s*(\d+)(?:\s*-\s*NK\s*(\d+))?$/i);
    if (!m) return null;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    return { start: start, end: end };
}

function format_heat_number(start, end) {
    return start === end ? `NK${start}` : `NK${start} - NK${end}`;
}


frappe.ui.form.on('Purchase Receipt Item', {
    form_render: function(frm, cdt, cdn) {
        render_qc_supplier_table(frm, cdt, cdn);
    },

    custom_create_heat_number(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.custom_qty_in_no || row.custom_qty_in_no <= 0) {
            frappe.msgprint("Please set a valid Qty In No before generating Heat Number.");
            return;
        }

        let msg = row.custom_single_heat_number
            ? __("Are you sure you want to create <b>Single Heat Number</b> for item <b>{0}</b>?", [row.item_code])
            : __("Are you sure you want to create <b>Multiple Heat Numbers</b> for item <b>{0}</b>?", [row.item_code]);

        frappe.confirm(
            msg,
            function () {
                frappe.call({
                    method: "nmtg.override.api.create_heat_number",
                    args: {
                        po: frm.doc.name,
                        row_name: row.name
                    },
                    callback(r) {
                        if (r.message) {
                            frappe.model.set_value(cdt, cdn, "custom_nmtg_heat_number", r.message);

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

                            frm.refresh_field("items");
                            frm.refresh_field("custom_supplier_selection_for_qc");
                        }
                    }
                });
            },
            function () {
                frappe.show_alert({
                    message: __("Heat Number creation cancelled"),
                    indicator: "orange"
                });
            }
        );
    }
});

frappe.ui.form.on("Purchase Receipt", {
    refresh: function(frm) {
        // ── Internal QC (draft GRN) → standard Quality Inspection ──
        if (!frm.is_new() && frm.doc.docstatus === 0 && frappe.model.can_create("Quality Inspection")) {
            setTimeout(() => {
                frm.remove_custom_button(__("Quality Inspection(s)"), __("Create"));
                frm.add_custom_button(__("Quality Inspection(s)"), function() {
                    custom_make_internal_quality_inspection(frm);
                }, __("Create"));
            }, 100);
        }

        // ── Third Party QC (submitted GRN) → Third Party Quality Inspection ──
        if (
            frm.doc.docstatus === 1 &&
            !frm.doc.is_return &&
            (frm.doc.custom_supplier_selection_for_qc || []).length &&
            frappe.model.can_create("Third Party Quality Inspection")
        ) {
            frm.add_custom_button(__("Third Party Quality Inspection"), function() {
                custom_make_third_party_quality_inspection(frm);
            }, __("Create"));
        }

        if (frm.doc.is_return && (frm.doc.custom_supplier_selection_for_qc || []).length) {
            frm.clear_table("custom_supplier_selection_for_qc");
            frm.refresh_field("custom_supplier_selection_for_qc");
        }
    },

    setup(frm) {
        frm.fields_dict.custom_supplier_selection_for_qc.grid.get_field("item").get_query =
            function(doc, cdt, cdn) {
                let item_list = (doc.items || []).map(row => row.item_code).filter(Boolean);
                return {
                    filters: {
                        name: ["in", item_list.length ? item_list : [""]]
                    }
                };
            };
    },

    is_return: function(frm) {
        if (frm.doc.is_return) {
            frm.clear_table("custom_supplier_selection_for_qc");
            frm.refresh_field("custom_supplier_selection_for_qc");
        }
    },

    validate: function(frm) {
        if (frm.doc.is_return && (frm.doc.custom_supplier_selection_for_qc || []).length) {
            frm.clear_table("custom_supplier_selection_for_qc");
            frm.refresh_field("custom_supplier_selection_for_qc");
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
                    <td><span class="qc-badge">${frappe.utils.escape_html(r.supplier || '')}</span></td>
                    <td>${r.qty || 0}</td>
                    <td>${frappe.utils.escape_html(r.nmtg_heat_number || '')}</td>
                    <td>${testing_tags}</td>
                </tr>`;
        });
    }

    html += `</tbody></table></div>`;
    $(wrapper.wrapper).html(html);
}


// ════════════════════════════════════════════════════════════════════
//  INTERNAL QC  →  standard "Quality Inspection"
//  One document per GRN item row, for the full qty, NMTG code only.
// ════════════════════════════════════════════════════════════════════
function custom_make_internal_quality_inspection(frm) {
    let data = [];
    const duplicate_rows = new Set();   // child_row_reference of items that already have a QI

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
                { fieldtype: "Data", fieldname: "child_row_reference",      hidden: true },
                { fieldtype: "Data", fieldname: "nmtg_heat_number",         hidden: true },
                { fieldtype: "Data", fieldname: "custom_vendor_heat_number", hidden: true },
                { fieldtype: "Data", fieldname: "custom_mill_tc",           hidden: true },
                {
                    fieldtype: "Read Only", fieldname: "item_code",
                    label: __("Item Code"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Read Only", fieldname: "item_name",
                    label: __("Item Name"), in_list_view: true, columns: 3,
                },
                {
                    fieldtype: "Read Only", fieldname: "nmtg_heat_number_display",
                    label: __("NMTG Code"), in_list_view: true, columns: 2,
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
                    fieldtype: "Read Only", fieldname: "duplicate_label",
                    label: __("Status"), in_list_view: true, columns: 2,
                },
            ],
        },
    ];

    const dialog = new frappe.ui.Dialog({
        title: __("Select Items for Internal Quality Inspection"),
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

            if (selected.some(r => duplicate_rows.has(r.child_row_reference))) {
                frappe.msgprint(__("One or more selected rows already have a Quality Inspection. Please deselect them."));
                return;
            }

            frappe.call({
                method: "nmtg.override.purchase_receipt.make_quality_inspections_custom",
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
                        nmtg_heat_number:          r.nmtg_heat_number,
                        custom_vendor_heat_number: r.custom_vendor_heat_number,
                        custom_mill_tc:            r.custom_mill_tc,
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

    let grid_field = dialog.fields_dict.items;

    const unique_item_codes = [
        ...new Set((frm.doc.items || []).map(i => i.item_code).filter(Boolean))
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
            const qc_percent_map = {};
            (res.message || []).forEach(item => {
                qc_percent_map[item.item_code] = flt(item.custom_quality_inspection_percent) || 0;
            });

            (frm.doc.items || []).forEach(item => {
                const qty = flt(item.custom_qty_in_no || item.qty) || 0;
                const percent = qc_percent_map[item.item_code] || 0;
                const sample_size = percent > 0 ? Math.ceil(qty * percent / 100) : 0;

                grid_field.df.data.push({
                    docname:                   item.name,
                    child_row_reference:       item.name,
                    item_code:                 item.item_code,
                    item_name:                 item.item_name,
                    nmtg_heat_number:          item.custom_nmtg_heat_number || "",
                    nmtg_heat_number_display:  item.custom_nmtg_heat_number || "",
                    custom_vendor_heat_number: item.custom_vendor_heat_number || "",
                    custom_mill_tc:            item.custom_mill_tc || "",
                    qty:                       qty,
                    sample_size:               sample_size,
                    duplicate_label:           __("Checking…"),
                });
            });

            if (!grid_field.df.data.length) {
                frappe.msgprint(__("No items found."));
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
                    fields: ["name", "child_row_reference"],
                    limit_page_length: 500,
                },
                callback: function(res) {
                    (res.message || []).forEach(qi => {
                        if (qi.child_row_reference) duplicate_rows.add(qi.child_row_reference);
                    });

                    grid_field.df.data.forEach(row => {
                        row.duplicate_label = duplicate_rows.has(row.child_row_reference)
                            ? __("⚠ QI Exists")
                            : __("✔ New");
                    });

                    grid_field.grid.refresh();

                    setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_rows), 150);
                }
            });
        }
    });
}


function apply_duplicate_row_styles(grid_field, duplicate_rows) {
    grid_field.grid.wrapper.find(".grid-row").each(function() {
        const $row = $(this);
        const cdn  = $row.attr("data-name");
        if (!cdn) return;

        const row_data = grid_field.df.data.find(r => r.name === cdn);
        if (!row_data || !duplicate_rows.has(row_data.child_row_reference)) return;

        $row.find(".row-check input[type='checkbox']").prop("checked", false).prop("disabled", true);
        $row.css({ "opacity": "0.45", "pointer-events": "none" });
    });

    grid_field.grid.wrapper.off("change.dup_guard").on("change.dup_guard",
        ".grid-heading-row input[type='checkbox']", function() {
            setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_rows), 30);
        }
    );
}


// ════════════════════════════════════════════════════════════════════
//  THIRD PARTY QC  →  "Third Party Quality Inspection"
//  One document per custom_supplier_selection_for_qc row (lab-wise),
//  available only after the GRN is submitted.
// ════════════════════════════════════════════════════════════════════
function custom_make_third_party_quality_inspection(frm) {
    frappe.confirm(
        __("Create Third Party Quality Inspection(s) for all lab entries of this GRN that don't have one yet?"),
        function() {
            frappe.call({
                method: "nmtg.override.purchase_receipt.make_third_party_quality_inspections",
                args: { docname: frm.doc.name },
                freeze: true,
                freeze_message: __("Creating Third Party Quality Inspection(s)…"),
                callback: function(r) {
                    const res = r.message || {};
                    const created = res.created || [];
                    const skipped = res.skipped || 0;

                    if (!created.length) {
                        frappe.msgprint(__("All lab entries already have a Third Party Quality Inspection."));
                        return;
                    }

                    if (skipped) {
                        frappe.show_alert({
                            message: __("{0} entr(ies) skipped — already created.", [skipped]),
                            indicator: "orange"
                        });
                    }

                    if (created.length === 1) {
                        frappe.set_route("Form", "Third Party Quality Inspection", created[0]);
                    } else {
                        frappe.route_options = { grn: frm.doc.name };
                        frappe.set_route("List", "Third Party Quality Inspection");
                    }
                }
            });
        }
    );
}


// ════════════════════════════════════════════════════════════════════
//  Supplier Selection For QC — auto-fills NMTG code on qty:
//    qty = 1  → single code (NK533)
//    qty > 1  → range (NK533 - NK535)
// ════════════════════════════════════════════════════════════════════
frappe.ui.form.on("Supplier Selection For QC", {
    item(frm, cdt, cdn) {
        frappe.model.set_value(cdt, cdn, "qty", 0);
        frappe.model.set_value(cdt, cdn, "nmtg_heat_number", "");
    },

    form_render: function(frm, cdt, cdn) {
        render_testing_type_checkboxes(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.item || !row.qty) {
            frappe.model.set_value(cdt, cdn, "nmtg_heat_number", "");
            return;
        }

        let qty = cint(row.qty);
        if (qty !== flt(row.qty) || qty < 1) {
            frappe.msgprint(__("Qty must be a whole number of at least 1."));
            frappe.model.set_value(cdt, cdn, "qty", 0);
            return;
        }

        let total_qty = 0;
        (frm.doc.items || []).forEach(d => {
            if (d.item_code === row.item) {
                total_qty += flt(d.custom_qty_in_no || d.qty);
            }
        });

        let qc_qty = 0;
        (frm.doc.custom_supplier_selection_for_qc || []).forEach(d => {
            if (d.item === row.item && d.name !== row.name) {
                qc_qty += flt(d.qty);
            }
        });

        let remaining = total_qty - qc_qty;

        if (qty > remaining) {
            frappe.msgprint(
                `<b>${row.item}</b>: Only <b>${remaining}</b> qty remaining to allocate ` +
                `(Total: ${total_qty}, already allocated in other rows: ${qc_qty}).`
            );
            frappe.model.set_value(cdt, cdn, "qty", 0);
            return;
        }

        // ── Auto-fill NMTG code from the GRN item's heat number ──
        let pr_item = (frm.doc.items || []).find(d => d.item_code === row.item);
        if (!pr_item || !pr_item.custom_nmtg_heat_number) {
            frappe.msgprint(__("Heat Number not generated yet for item <b>{0}</b>.", [row.item]));
            return;
        }

        let pr = parse_heat_number(pr_item.custom_nmtg_heat_number);
        if (!pr) return;

        // Single heat number item → every row carries the same one code
        if (pr_item.custom_single_heat_number) {
            frappe.model.set_value(cdt, cdn, "nmtg_heat_number", format_heat_number(pr.start, pr.start));
            return;
        }

        // Ranges already used by other rows of the same item
        let used = [];
        (frm.doc.custom_supplier_selection_for_qc || []).forEach(d => {
            if (d.item === row.item && d.name !== row.name) {
                let p = parse_heat_number(d.nmtg_heat_number);
                if (p) used.push(p);
            }
        });
        used.sort((a, b) => a.start - b.start);

        // First free block of `qty` consecutive codes inside the GRN range
        let start = pr.start;
        for (let u of used) {
            if (start + qty - 1 < u.start) break;     // fits before this used block
            if (u.end + 1 > start) start = u.end + 1; // otherwise jump past it
        }
        let end = start + qty - 1;

        if (end > pr.end) {
            frappe.msgprint(
                __("No free Heat Numbers left for {0} qty in <b>{1}</b> (GRN range: {2}).",
                    [qty, row.item, pr_item.custom_nmtg_heat_number])
            );
            frappe.model.set_value(cdt, cdn, "qty", 0);
            return;
        }

        frappe.model.set_value(cdt, cdn, "nmtg_heat_number", format_heat_number(start, end));
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

                    locals[cdt][cdn].testing_value = val_str;
                    let doc_row = (frm.doc.custom_supplier_selection_for_qc || [])
                        .find(d => d.name === cdn);
                    if (doc_row) doc_row.testing_value = val_str;

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
}// ── Heat number helpers ──────────────────────────────────────────────
function parse_heat_number(text) {
    const m = String(text || "").replace(/\n/g, " ").trim().match(/^NK\s*(\d+)(?:\s*-\s*NK\s*(\d+))?$/i);
    if (!m) return null;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    return { start: start, end: end };
}

function format_heat_number(start, end) {
    return start === end ? `NK${start}` : `NK${start} - NK${end}`;
}


frappe.ui.form.on('Purchase Receipt Item', {
    form_render: function(frm, cdt, cdn) {
        render_qc_supplier_table(frm, cdt, cdn);
    },

    custom_create_heat_number(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.custom_qty_in_no || row.custom_qty_in_no <= 0) {
            frappe.msgprint("Please set a valid Qty In No before generating Heat Number.");
            return;
        }

        let msg = row.custom_single_heat_number
            ? __("Are you sure you want to create <b>Single Heat Number</b> for item <b>{0}</b>?", [row.item_code])
            : __("Are you sure you want to create <b>Multiple Heat Numbers</b> for item <b>{0}</b>?", [row.item_code]);

        frappe.confirm(
            msg,
            function () {
                frappe.call({
                    method: "nmtg.override.api.create_heat_number",
                    args: {
                        po: frm.doc.name,
                        row_name: row.name
                    },
                    callback(r) {
                        if (r.message) {
                            frappe.model.set_value(cdt, cdn, "custom_nmtg_heat_number", r.message);

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

                            frm.refresh_field("items");
                            frm.refresh_field("custom_supplier_selection_for_qc");
                        }
                    }
                });
            },
            function () {
                frappe.show_alert({
                    message: __("Heat Number creation cancelled"),
                    indicator: "orange"
                });
            }
        );
    }
});

frappe.ui.form.on("Purchase Receipt", {
    refresh: function(frm) {
        // ── Internal QC (draft GRN) → standard Quality Inspection ──
        if (!frm.is_new() && frm.doc.docstatus === 0 && frappe.model.can_create("Quality Inspection")) {
            setTimeout(() => {
                frm.remove_custom_button(__("Quality Inspection(s)"), __("Create"));
                frm.add_custom_button(__("Quality Inspection(s)"), function() {
                    custom_make_internal_quality_inspection(frm);
                }, __("Create"));
            }, 100);
        }

        // ── Third Party QC (submitted GRN) → Third Party Quality Inspection ──
        if (
            frm.doc.docstatus === 1 &&
            !frm.doc.is_return &&
            (frm.doc.custom_supplier_selection_for_qc || []).length &&
            frappe.model.can_create("Third Party Quality Inspection")
        ) {
            frm.add_custom_button(__("Third Party Quality Inspection"), function() {
                custom_make_third_party_quality_inspection(frm);
            }, __("Create"));
        }

        if (frm.doc.is_return && (frm.doc.custom_supplier_selection_for_qc || []).length) {
            frm.clear_table("custom_supplier_selection_for_qc");
            frm.refresh_field("custom_supplier_selection_for_qc");
        }
    },

    setup(frm) {
        frm.fields_dict.custom_supplier_selection_for_qc.grid.get_field("item").get_query =
            function(doc, cdt, cdn) {
                let item_list = (doc.items || []).map(row => row.item_code).filter(Boolean);
                return {
                    filters: {
                        name: ["in", item_list.length ? item_list : [""]]
                    }
                };
            };
    },

    is_return: function(frm) {
        if (frm.doc.is_return) {
            frm.clear_table("custom_supplier_selection_for_qc");
            frm.refresh_field("custom_supplier_selection_for_qc");
        }
    },

    validate: function(frm) {
        if (frm.doc.is_return && (frm.doc.custom_supplier_selection_for_qc || []).length) {
            frm.clear_table("custom_supplier_selection_for_qc");
            frm.refresh_field("custom_supplier_selection_for_qc");
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
                    <td><span class="qc-badge">${frappe.utils.escape_html(r.supplier || '')}</span></td>
                    <td>${r.qty || 0}</td>
                    <td>${frappe.utils.escape_html(r.nmtg_heat_number || '')}</td>
                    <td>${testing_tags}</td>
                </tr>`;
        });
    }

    html += `</tbody></table></div>`;
    $(wrapper.wrapper).html(html);
}


// ════════════════════════════════════════════════════════════════════
//  INTERNAL QC  →  standard "Quality Inspection"
//  One document per GRN item row, for the full qty, NMTG code only.
// ════════════════════════════════════════════════════════════════════
function custom_make_internal_quality_inspection(frm) {
    let data = [];
    const duplicate_rows = new Set();   // child_row_reference of items that already have a QI

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
                { fieldtype: "Data", fieldname: "child_row_reference",      hidden: true },
                { fieldtype: "Data", fieldname: "nmtg_heat_number",         hidden: true },
                { fieldtype: "Data", fieldname: "custom_vendor_heat_number", hidden: true },
                { fieldtype: "Data", fieldname: "custom_mill_tc",           hidden: true },
                {
                    fieldtype: "Read Only", fieldname: "item_code",
                    label: __("Item Code"), in_list_view: true, columns: 2,
                },
                {
                    fieldtype: "Read Only", fieldname: "item_name",
                    label: __("Item Name"), in_list_view: true, columns: 3,
                },
                {
                    fieldtype: "Read Only", fieldname: "nmtg_heat_number_display",
                    label: __("NMTG Code"), in_list_view: true, columns: 2,
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
                    fieldtype: "Read Only", fieldname: "duplicate_label",
                    label: __("Status"), in_list_view: true, columns: 2,
                },
            ],
        },
    ];

    const dialog = new frappe.ui.Dialog({
        title: __("Select Items for Internal Quality Inspection"),
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

            if (selected.some(r => duplicate_rows.has(r.child_row_reference))) {
                frappe.msgprint(__("One or more selected rows already have a Quality Inspection. Please deselect them."));
                return;
            }

            frappe.call({
                method: "nmtg.override.purchase_receipt.make_quality_inspections_custom",
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
                        nmtg_heat_number:          r.nmtg_heat_number,
                        custom_vendor_heat_number: r.custom_vendor_heat_number,
                        custom_mill_tc:            r.custom_mill_tc,
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

    let grid_field = dialog.fields_dict.items;

    const unique_item_codes = [
        ...new Set((frm.doc.items || []).map(i => i.item_code).filter(Boolean))
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
            const qc_percent_map = {};
            (res.message || []).forEach(item => {
                qc_percent_map[item.item_code] = flt(item.custom_quality_inspection_percent) || 0;
            });

            (frm.doc.items || []).forEach(item => {
                const qty = flt(item.custom_qty_in_no || item.qty) || 0;
                const percent = qc_percent_map[item.item_code] || 0;
                const sample_size = percent > 0 ? Math.ceil(qty * percent / 100) : 0;

                grid_field.df.data.push({
                    docname:                   item.name,
                    child_row_reference:       item.name,
                    item_code:                 item.item_code,
                    item_name:                 item.item_name,
                    nmtg_heat_number:          item.custom_nmtg_heat_number || "",
                    nmtg_heat_number_display:  item.custom_nmtg_heat_number || "",
                    custom_vendor_heat_number: item.custom_vendor_heat_number || "",
                    custom_mill_tc:            item.custom_mill_tc || "",
                    qty:                       qty,
                    sample_size:               sample_size,
                    duplicate_label:           __("Checking…"),
                });
            });

            if (!grid_field.df.data.length) {
                frappe.msgprint(__("No items found."));
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
                    fields: ["name", "child_row_reference"],
                    limit_page_length: 500,
                },
                callback: function(res) {
                    (res.message || []).forEach(qi => {
                        if (qi.child_row_reference) duplicate_rows.add(qi.child_row_reference);
                    });

                    grid_field.df.data.forEach(row => {
                        row.duplicate_label = duplicate_rows.has(row.child_row_reference)
                            ? __("⚠ QI Exists")
                            : __("✔ New");
                    });

                    grid_field.grid.refresh();

                    setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_rows), 150);
                }
            });
        }
    });
}


function apply_duplicate_row_styles(grid_field, duplicate_rows) {
    grid_field.grid.wrapper.find(".grid-row").each(function() {
        const $row = $(this);
        const cdn  = $row.attr("data-name");
        if (!cdn) return;

        const row_data = grid_field.df.data.find(r => r.name === cdn);
        if (!row_data || !duplicate_rows.has(row_data.child_row_reference)) return;

        $row.find(".row-check input[type='checkbox']").prop("checked", false).prop("disabled", true);
        $row.css({ "opacity": "0.45", "pointer-events": "none" });
    });

    grid_field.grid.wrapper.off("change.dup_guard").on("change.dup_guard",
        ".grid-heading-row input[type='checkbox']", function() {
            setTimeout(() => apply_duplicate_row_styles(grid_field, duplicate_rows), 30);
        }
    );
}


// ════════════════════════════════════════════════════════════════════
//  THIRD PARTY QC  →  "Third Party Quality Inspection"
//  One document per custom_supplier_selection_for_qc row (lab-wise),
//  available only after the GRN is submitted.
// ════════════════════════════════════════════════════════════════════
function custom_make_third_party_quality_inspection(frm) {
    frappe.confirm(
        __("Create Third Party Quality Inspection(s) for all lab entries of this GRN that don't have one yet?"),
        function() {
            frappe.call({
                method: "nmtg.override.purchase_receipt.make_third_party_quality_inspections",
                args: { docname: frm.doc.name },
                freeze: true,
                freeze_message: __("Creating Third Party Quality Inspection(s)…"),
                callback: function(r) {
                    const res = r.message || {};
                    const created = res.created || [];
                    const skipped = res.skipped || 0;

                    if (!created.length) {
                        frappe.msgprint(__("All lab entries already have a Third Party Quality Inspection."));
                        return;
                    }

                    if (skipped) {
                        frappe.show_alert({
                            message: __("{0} entr(ies) skipped — already created.", [skipped]),
                            indicator: "orange"
                        });
                    }

                    if (created.length === 1) {
                        frappe.set_route("Form", "Third Party Quality Inspection", created[0]);
                    } else {
                        frappe.route_options = { grn: frm.doc.name };
                        frappe.set_route("List", "Third Party Quality Inspection");
                    }
                }
            });
        }
    );
}


// ════════════════════════════════════════════════════════════════════
//  Supplier Selection For QC — auto-fills NMTG code on qty:
//    qty = 1  → single code (NK533)
//    qty > 1  → range (NK533 - NK535)
// ════════════════════════════════════════════════════════════════════
frappe.ui.form.on("Supplier Selection For QC", {
    item(frm, cdt, cdn) {
        frappe.model.set_value(cdt, cdn, "qty", 0);
        frappe.model.set_value(cdt, cdn, "nmtg_heat_number", "");
    },

    form_render: function(frm, cdt, cdn) {
        render_testing_type_checkboxes(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.item || !row.qty) {
            frappe.model.set_value(cdt, cdn, "nmtg_heat_number", "");
            return;
        }

        let qty = cint(row.qty);
        if (qty !== flt(row.qty) || qty < 1) {
            frappe.msgprint(__("Qty must be a whole number of at least 1."));
            frappe.model.set_value(cdt, cdn, "qty", 0);
            return;
        }

        let total_qty = 0;
        (frm.doc.items || []).forEach(d => {
            if (d.item_code === row.item) {
                total_qty += flt(d.custom_qty_in_no || d.qty);
            }
        });

        let qc_qty = 0;
        (frm.doc.custom_supplier_selection_for_qc || []).forEach(d => {
            if (d.item === row.item && d.name !== row.name) {
                qc_qty += flt(d.qty);
            }
        });

        let remaining = total_qty - qc_qty;

        if (qty > remaining) {
            frappe.msgprint(
                `<b>${row.item}</b>: Only <b>${remaining}</b> qty remaining to allocate ` +
                `(Total: ${total_qty}, already allocated in other rows: ${qc_qty}).`
            );
            frappe.model.set_value(cdt, cdn, "qty", 0);
            return;
        }

        // ── Auto-fill NMTG code from the GRN item's heat number ──
        let pr_item = (frm.doc.items || []).find(d => d.item_code === row.item);
        if (!pr_item || !pr_item.custom_nmtg_heat_number) {
            frappe.msgprint(__("Heat Number not generated yet for item <b>{0}</b>.", [row.item]));
            return;
        }

        let pr = parse_heat_number(pr_item.custom_nmtg_heat_number);
        if (!pr) return;

        // Single heat number item → every row carries the same one code
        if (pr_item.custom_single_heat_number) {
            frappe.model.set_value(cdt, cdn, "nmtg_heat_number", format_heat_number(pr.start, pr.start));
            return;
        }

        // Ranges already used by other rows of the same item
        let used = [];
        (frm.doc.custom_supplier_selection_for_qc || []).forEach(d => {
            if (d.item === row.item && d.name !== row.name) {
                let p = parse_heat_number(d.nmtg_heat_number);
                if (p) used.push(p);
            }
        });
        used.sort((a, b) => a.start - b.start);

        // First free block of `qty` consecutive codes inside the GRN range
        let start = pr.start;
        for (let u of used) {
            if (start + qty - 1 < u.start) break;     // fits before this used block
            if (u.end + 1 > start) start = u.end + 1; // otherwise jump past it
        }
        let end = start + qty - 1;

        if (end > pr.end) {
            frappe.msgprint(
                __("No free Heat Numbers left for {0} qty in <b>{1}</b> (GRN range: {2}).",
                    [qty, row.item, pr_item.custom_nmtg_heat_number])
            );
            frappe.model.set_value(cdt, cdn, "qty", 0);
            return;
        }

        frappe.model.set_value(cdt, cdn, "nmtg_heat_number", format_heat_number(start, end));
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

                    locals[cdt][cdn].testing_value = val_str;
                    let doc_row = (frm.doc.custom_supplier_selection_for_qc || [])
                        .find(d => d.name === cdn);
                    if (doc_row) doc_row.testing_value = val_str;

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