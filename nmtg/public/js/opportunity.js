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
        update_technical_status(frm);
    },
    status: function(frm) {
        update_technical_status(frm);
    },

  
});



function update_technical_status(frm) {
    let technical_status = "";

    if (frm.doc.status === "Technical Evaluation Under Review") {
        technical_status = "Under Review";
    }
    else if (frm.doc.status === "Technical Evaluation Cleared") {
        technical_status = "Approved";
    }
    else if (frm.doc.status === "Open") {
        technical_status = "Draft";
    }

    if (!technical_status) {
        return;
    }

    (frm.doc.items || []).forEach(row => {
        frappe.model.set_value(
            row.doctype,
            row.name,
            "custom_technical_status",
            technical_status
        );
    });

    frm.refresh_field("items");
}

function create_enquiry_item_summary(frm) {
    frappe.model.with_doctype('Technical Evaluation', function () {
        let new_doc = frappe.model.get_new_doc('Technical Evaluation');

        new_doc.opportunity_no = frm.doc.name;
        new_doc.reference_type = frm.doc.opportunity_from;
        new_doc.opportunity_form = frm.doc.party_name;
        new_doc.customer = frm.doc.title || frm.doc.name;
        new_doc.custom_primary_contact_email = frm.doc.custom_primary_contact_email;
        new_doc.custom_other_contact_emails =frm.doc.custom_other_contact_emails;

        let primary_contact = (frm.doc.custom_contact || []).find(row => row.primary_contact);
        new_doc.email = primary_contact ? primary_contact.email_id : "";

        frappe.set_route('Form', 'Technical Evaluation', new_doc.name);
    });
}