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
            frm.add_custom_button(__('Enquiry Item Summary'), function () {
                create_enquiry_item_summary(frm);
            }, __('Create'));
        }
    }
});

function create_enquiry_item_summary(frm) {
    frappe.model.with_doctype('Enquiry Item Summary', function () {
        let new_doc = frappe.model.get_new_doc('Enquiry Item Summary');

        new_doc.opportunity_no = frm.doc.name;
        new_doc.reference_type = frm.doc.opportunity_from;
        new_doc.opportunity_form = frm.doc.party_name;
        new_doc.enquiry_reference = frm.doc.title || frm.doc.name;

        frappe.set_route('Form', 'Enquiry Item Summary', new_doc.name);
    });
}