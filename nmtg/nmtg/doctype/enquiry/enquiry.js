// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.ui.form.on("Enquiry", {
	refresh(frm) {
		if (!frm.is_new() && frm.doc.docstatus == 1 && !frm.doc.opportunity) {
			frm.add_custom_button(__("Create Opportunity"), () => {
				frappe.call({
					method: "nmtg.nmtg.doctype.enquiry.enquiry.create_opportunity",
					args: {
						enquiry: frm.doc.name
                        
					},
					callback(r) {
						if (r.message) {
							frappe.set_route("Form", "Opportunity", r.message);
						}
					}
				});
			}, __("Create"));
		}
	}
});