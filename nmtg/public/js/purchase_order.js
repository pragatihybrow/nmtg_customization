frappe.ui.form.on("Purchase Order Item", {
    custom_create_heat_number(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

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