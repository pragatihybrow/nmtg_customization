// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt
frappe.ui.form.on("Supplier Registration Form", {
    refresh(frm) {
        frm.fields_dict.rating_image.$wrapper.html(`
            <div style="text-align:center;">
                <img
                    src="/files/Screenshot%20from%202026-07-07%2014-34-47.png"
                    style="max-width:100%; height:auto; border-radius:4px;"
                >
            </div>
        `);
    },
    no_of_non_technical_employees: function(frm) {
            calculate_total_employees(frm);
        },
        no_of_technical_employees: function(frm) {
            calculate_total_employees(frm);
        }
    });

function calculate_total_employees(frm) {
    let non_technical = flt(frm.doc.no_of_non_technical_employees);
    let technical = flt(frm.doc.no_of_technical_employees);

    frm.set_value('no_of_employees', non_technical + technical);
}