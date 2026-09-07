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
        new_doc.custom_customer_rfq_number = frm.doc.custom_customer_rfq_number;

        let primary_contact = (frm.doc.custom_contact || []).find(row => row.primary_contact);
        new_doc.email = primary_contact ? primary_contact.email_id : "";

        frappe.set_route('Form', 'Technical Evaluation', new_doc.name);
    });
}

const PRICE_LIST = "Standard Selling"; 

frappe.ui.form.on("Opportunity Item", {
	item_code: function (frm, cdt, cdn) {
		check_rate_vs_price_list(frm, cdt, cdn);
	},
	rate: function (frm, cdt, cdn) {
		check_rate_vs_price_list(frm, cdt, cdn);
	},
	items_add: function (frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.__remark_mandatory = 0;
	},
	form_render: function (frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		frm.fields_dict["items"].grid.grid_rows_by_docname[cdn]
			.set_field_property("custom_remarks", "reqd", row.__remark_mandatory ? 1 : 0);
	},
});

function check_rate_vs_price_list(frm, cdt, cdn) {
	let row = locals[cdt][cdn];

	if (!row.item_code || row.rate === undefined || row.rate === null) {
		row.__remark_mandatory = 0;
		return;
	}

	frappe.db.get_value(
		"Item Price",
		{ item_code: row.item_code, price_list: PRICE_LIST, selling: 1 },
		"price_list_rate"
	).then((r) => {
		let price_list_rate = flt(r.message && r.message.price_list_rate);
		let entered_rate = flt(row.rate);

		row.__price_list_rate = price_list_rate;
		row.__remark_mandatory = price_list_rate && entered_rate !== price_list_rate ? 1 : 0;

		let grid_row = frm.fields_dict["items"].grid.grid_rows_by_docname[cdn];
		if (grid_row && grid_row.grid_form) {
			grid_row.set_field_property("custom_remarks", "reqd", row.__remark_mandatory);
		}

		frm.fields_dict["items"].grid.refresh();
	});
}

frappe.ui.form.on("Opportunity", {
	validate: function (frm) {
		let missing = [];

		(frm.doc.items || []).forEach((row) => {
			if (row.__remark_mandatory && !row.custom_remarks) {
				missing.push(row.idx);
			}
		});

		if (missing.length) {
			frappe.throw(
				__("Remark is mandatory for Item row(s) {0} since Rate differs from the Price List Rate.", [
					missing.join(", "),
				])
			);
		}
	},
});