frappe.ui.form.on("Prospect", {
	onload: function (frm) {
		if (frm.is_new() && !frm.doc.prospect_owner) {
			frm.set_value("prospect_owner", frappe.session.user);
		}
	},
});