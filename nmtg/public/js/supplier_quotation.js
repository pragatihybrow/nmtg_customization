frappe.ui.form.on("Supplier Quotation", {
    grand_total(frm) {
        calculate_payment_terms(frm);
    },

    validate(frm) {
        calculate_payment_terms(frm);

        let total_percentage = 0;

        (frm.doc.custom_payement_terms || []).forEach(row => {
            total_percentage += flt(row.percentage);
        });

        if (total_percentage !== 100) {
            frappe.throw(
                __("Total Payment Terms Percentage must be exactly 100%. Current total is {0}%.",
                [total_percentage])
            );
        }
    },
    custom_transportation_arrange_by: function(frm) {
        maybe_refresh_on_clear(frm, 'custom_transportation_arrange_by');
    },
    custom_additional_charges: function(frm) {
        maybe_refresh_on_clear(frm, 'custom_additional_charges');
    }
});


frappe.ui.form.on("Supplier Payment Terms CT", {
    percentage(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (flt(row.percentage) > 100) {
            frappe.model.set_value(cdt, cdn, "percentage", 100);
        }

        let total = flt(frm.doc.grand_total);

        let amount = (total * flt(row.percentage)) / 100;

        frappe.model.set_value(cdt, cdn, "amount", amount);

        calculate_payment_terms(frm, true);
    },

    amount(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        let total = flt(frm.doc.grand_total);

        if (total > 0) {
            let percentage = (flt(row.amount) / total) * 100;

            frappe.model.set_value(
                cdt,
                cdn,
                "percentage",
                flt(percentage, 2)
            );
        }

        calculate_payment_terms(frm, true);
    }
});


function calculate_payment_terms(frm, skip_amount_update = false) {

    let total = flt(frm.doc.grand_total);

    if (!total) {
        return;
    }

    (frm.doc.custom_payement_terms || []).forEach(row => {

        if (!skip_amount_update && flt(row.percentage)) {

            let amount = (total * flt(row.percentage)) / 100;

            frappe.model.set_value(
                row.doctype,
                row.name,
                "amount",
                flt(amount, 2)
            );
        }
    });
}

function sync_charges(frm) {
    frappe.call({
        method: "nmtg.override.supplier_quotation.handle_transportation_item",
        args: { doc: frm.doc },
        callback: function(r) {
            frm.reload_doc();  
        }
    });
}


function maybe_refresh_on_clear(frm, fieldname) {
    if (frm.doc[fieldname]) return;
    if (frm.is_new()) return;   

    frappe.call({
        method: "frappe.client.save",
        args: { doc: frm.doc },
        freeze: true,
        freeze_message: __("Updating charges..."),
        callback: function(r) {
            if (r.message) {
                frm.reload_doc();
            }
        }
    });
}