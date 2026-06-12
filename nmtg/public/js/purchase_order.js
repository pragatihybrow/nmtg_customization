frappe.ui.form.on("Purchase Order Item", {
    custom_create_heat_number(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.qty || row.qty <= 0) {
            frappe.msgprint("Please set a valid Qty before generating Heat Number.");
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
                }
            }
        });
    }
});

frappe.ui.form.on("Purchase Order", {
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

frappe.ui.form.on("Supplier Selection For QC", {
    item(frm, cdt, cdn) {
        // When item changes, reset qty to avoid stale values
        frappe.model.set_value(cdt, cdn, "qty", 0);
    },

     form_render: function(frm, cdt, cdn) {
        render_testing_type_checkboxes(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.item || !row.qty) return;

        // Total ordered qty for this item across PO items
        let po_qty = 0;
        (frm.doc.items || []).forEach(d => {
            if (d.item_code === row.item) {
                po_qty += flt(d.qty);
            }
        });

        // Sum of ALL qc rows for this item EXCLUDING the current row
        // (because locals already has the new value — we don't want to double-count)
        let qc_qty = 0;
        (frm.doc.custom_supplier_selection_for_qc || []).forEach(d => {
            if (d.item === row.item && d.name !== row.name) {
                qc_qty += flt(d.qty);
            }
        });

        let remaining = po_qty - qc_qty;

        if (flt(row.qty) > remaining) {
            frappe.msgprint(
                `<b>${row.item}</b>: Only <b>${remaining}</b> qty remaining to allocate ` +
                `(PO total: ${po_qty}, already allocated in other rows: ${qc_qty}).`
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