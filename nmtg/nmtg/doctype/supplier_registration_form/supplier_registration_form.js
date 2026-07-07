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
    }
});