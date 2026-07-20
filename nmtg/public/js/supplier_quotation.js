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