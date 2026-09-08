frappe.ui.form.on("Quotation", {
	setup: function (frm) {
		frm.set_query("quotation_to", function () {
			return {
				filters: {
					name: ["in", ["Customer", "Lead", "Prospect", "Enquiry"]],
				},
			};
		});
	},

	set_contact_link: function (frm) {
		if (frm.doc.quotation_to == "Enquiry" && frm.doc.party_name) {
			frappe.dynamic_link = { doc: frm.doc, fieldname: "party_name", doctype: "Enquiry" };
		}
	},
});
