frappe.ui.form.on("Opportunity", {
	setup: function (frm) {
		frm.set_query("opportunity_from", function () {
			return {
				filters: {
					name: ["in", ["Customer", "Lead", "Prospect", "Enquiry"]],
				},
			};
		});
	},

	set_contact_link: function (frm) {
		if (frm.doc.opportunity_from == "Enquiry" && frm.doc.party_name) {
			frappe.dynamic_link = { doc: frm.doc, fieldname: "party_name", doctype: "Enquiry" };
		}
	},
	refresh(frm) {
        if (!frm.is_new()) {
            frm.add_custom_button(__('Technical Evaluation'), function () {
                create_enquiry_item_summary(frm);
            }, __('Create'));
        }
    }
});

function create_enquiry_item_summary(frm) {
    frappe.model.with_doctype('Technical Evaluation', function () {
        let new_doc = frappe.model.get_new_doc('Technical Evaluation');

        new_doc.opportunity_no = frm.doc.name;
        new_doc.reference_type = frm.doc.opportunity_from;
        new_doc.opportunity_form = frm.doc.party_name;
        new_doc.customer = frm.doc.title || frm.doc.name;

        let primary_contact = (frm.doc.custom_contact || []).find(row => row.primary_contact);
        new_doc.email = primary_contact ? primary_contact.email_id : "";

        frappe.set_route('Form', 'Technical Evaluation', new_doc.name);
    });
}