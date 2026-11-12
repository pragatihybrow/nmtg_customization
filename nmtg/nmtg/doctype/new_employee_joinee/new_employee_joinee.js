// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt


frappe.ui.form.on("New Employee Joinee", {
	refresh(frm) {
		if (!frm.is_new() && !frm.doc.employee) {
			frm.add_custom_button(__("Create Employee"), () => {
				frappe.model.open_mapped_doc({
					method: "nmtg.nmtg.doctype.new_employee_joinee.new_employee_joinee.make_employee",
					frm: frm,
				});
			}).addClass("btn-primary");
		}
	},
});