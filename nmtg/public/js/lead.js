frappe.ui.form.on('Lead', {
    custom_customer_type: function(frm) {
        frm.set_value('custom_industry_ct', []);
        frm.set_value('custom_application', []);
        set_industry_filter(frm);
    },

    custom_industry_ct: function(frm) {
        frm.set_value('custom_application', []);
        set_application_filter(frm);
    },

    onload: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        set_first_row_name(frm);
        toggle_qualification_gated_buttons(frm);
        override_prospect_button(frm);
        override_quotation_button(frm);
        // override_opportunity_button(frm);
        override_customer_button(frm);
    },
    refresh: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        set_first_row_name(frm);
        setTimeout(() => toggle_qualification_gated_buttons(frm), 500);
        override_prospect_button(frm);
        override_quotation_button(frm);
        // override_opportunity_button(frm);
        override_customer_button(frm);
    },

    first_name(frm) {
        set_first_row_name(frm);
    },
    company_name(frm) {
        set_first_row_name(frm);
    }
});


function toggle_qualification_gated_buttons(frm) {
    if (frm.doc.workflow_state === "Qualified") return;

    frm.remove_custom_button("Customer", "Create");
    frm.remove_custom_button("Opportunity", "Create");
    frm.remove_custom_button("Quotation", "Create");
    frm.remove_custom_button("Prospect", "Create");
    frm.remove_custom_button("Add to Prospect", "Action");
}

function set_industry_filter(frm) {
    const customer_types = (frm.doc.custom_customer_type || [])
        .map(row => row.customer_type)
        .filter(Boolean);

    if (!customer_types.length) {
        frm.set_query('custom_industry_ct', () => ({ filters: [] }));
        return;
    }

    Promise.all(
        customer_types.map(ct =>
            frappe.db.get_doc('Customer Type', ct).catch(() => null)
        )
    ).then(docs => {
        const industry_names = [
            ...new Set(
                docs
                    .filter(Boolean)
                    .flatMap(doc => (doc.industry || []).map(row => row.industry).filter(Boolean))
            )
        ];

        frm.set_query('custom_industry_ct', function() {
            if (!industry_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', industry_names]] };
        });
    });
}

function set_application_filter(frm) {
    const industries = (frm.doc.custom_industry_ct || [])
        .map(row => row.industry)
        .filter(Boolean);

    if (!industries.length) {
        frm.set_query('custom_application', () => ({ filters: [] }));
        return;
    }

    Promise.all(
        industries.map(ind =>
            frappe.db.get_doc('Industry', ind).catch(() => null)
        )
    ).then(docs => {
        const application_names = [
            ...new Set(
                docs
                    .filter(Boolean)
                    .flatMap(doc => (doc.application || []).map(row => row.application).filter(Boolean))
            )
        ];

        frm.set_query('custom_application', function() {
            if (!application_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', application_names]] };
        });
    });
}

function set_first_row_name(frm) {
    let cname = frm.doc.first_name || frm.doc.company_name || '';
    if (!cname) return;

    if (!frm.doc.custom_contact_info || !frm.doc.custom_contact_info.length) {
        let row = frm.add_child('custom_contact_info');
        row.name1 = cname;
    } else {
        let row = frm.doc.custom_contact_info[0];
        // don't clobber a row once it's linked to an actual Contact
        if (row.name1 !== cname && !row.custom_contact_ref) {
            frappe.model.set_value(row.doctype, row.name, 'name1', cname);
        }
    }
    frm.refresh_field('custom_contact_info');
}

frappe.ui.form.on('Lead Contact Info', {
    email_id(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    contact_no(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    whatsapp_no(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    designation(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    name1(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); }
});

const debounced_sync_contact = frappe.utils.debounce(sync_contact, 800);

function sync_contact(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!row.name1) return;
    if (!row.email_id && !row.contact_no && !row.whatsapp_no) return;

    frappe.call({
        method: "nmtg.override.api.create_or_update_lead_contact",
        args: {
            row: row,
            lead: frm.doc.name
        },
        callback: function (r) {
            if (r.message) {
                frappe.model.set_value(cdt, cdn, 'custom_contact_ref', r.message);
            }

            
            frappe.call({
                method: 'frappe.client.get_value',
                args: {
                    doctype: 'Lead',
                    filters: frm.doc.name,
                    fieldname: 'modified'
                },
                callback: function (res) {
                    if (res.message && res.message.modified) {
                        frm.doc.modified = res.message.modified;
                    }
                }
            });
        }
    });
}


function copy_custom_field(values, target_doctype, frm, source_fieldname, target_fieldname) {
	target_fieldname = target_fieldname || source_fieldname;

	if (!frappe.meta.has_field(target_doctype, target_fieldname)) return;

	let df = frappe.meta.get_docfield(target_doctype, target_fieldname);
	let value = frm.doc[source_fieldname];
	if (value === undefined || value === null) return;

	if (df.fieldtype === "Table" || df.fieldtype === "Table MultiSelect") {
		if (!Array.isArray(value)) return;
		values[target_fieldname] = value.map((row) => {
			let clean = {};
			Object.keys(row).forEach((key) => {
				if (
					!["name", "owner", "creation", "modified", "modified_by", "parent", "parentfield", "parenttype", "doctype", "idx", "docstatus"].includes(key)
				) {
					clean[key] = row[key];
				}
			});
			return clean;
		});
	} else {
		values[target_fieldname] = value;
	}
}

function route_to_new_doc(doctype, values) {
	frappe.route_options = values;
	frappe.new_doc(doctype);
}


/* ---------------------------------------------------------------------
 * Prospect
 * ------------------------------------------------------------------- */
function override_prospect_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Prospect", "Create");
	frm.add_custom_button(__("Prospect"), () => make_prospect_from_lead(frm), __("Create"));
}

function make_prospect_from_lead(frm) {
	frappe.model.with_doctype("Prospect", () => {
		let values = {};

		// standard field mapping
		values.company_name = frm.doc.company_name;
		values.no_of_employees = frm.doc.no_of_employees;
		values.annual_revenue = frm.doc.annual_revenue;
		values.industry = frm.doc.industry;
		values.market_segment = frm.doc.market_segment;
		values.territory = frm.doc.territory;
		values.website = frm.doc.website;
		values.fax = frm.doc.fax;
		values.city = frm.doc.city;
		values.state = frm.doc.state;
		values.country = frm.doc.country;

		// link back to originating lead
		values.leads = [{
			lead: frm.doc.name,
			lead_name: frm.doc.lead_name,
			lead_owner: frm.doc.lead_owner,
		}];

		// custom fields — same fieldname on both sides
		[
			"custom_approx_annual_requirement",
			"custom_requirement_timeline",
			"custom_product_group",
			"custom_application",
			"custom_industry_ct",
			"custom_customer_type",
			"custom_contact_info",
			"custom_product_intrest",
		].forEach((fieldname) => copy_custom_field(values, "Prospect", frm, fieldname));

		// renamed on Lead (trailing underscore) vs Prospect
		copy_custom_field(values, "Prospect", frm, "custom_annual_turnover_", "custom_annual_turnover");
		copy_custom_field(values, "Prospect", frm, "custom_application_description_", "custom_application_description_");

		route_to_new_doc("Prospect", values);
	});
}


/* ---------------------------------------------------------------------
 * Opportunity
 * ------------------------------------------------------------------- */
function override_opportunity_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Opportunity", "Create");
	frm.add_custom_button(__("Opportunity"), () => make_opportunity_from_lead(frm), __("Create"));
}

function make_opportunity_from_lead(frm) {
	frappe.model.with_doctype("Opportunity", () => {
		let values = {};

		values.opportunity_from = "Lead";
		values.party_name = frm.doc.name;
		values.customer_name = frm.doc.company_name || frm.doc.lead_name;

		// standard field mapping
		values.no_of_employees = frm.doc.no_of_employees;
		values.annual_revenue = frm.doc.annual_revenue;
		values.industry = frm.doc.industry;
		values.market_segment = frm.doc.market_segment;
		values.territory = frm.doc.territory;
		values.website = frm.doc.website;
		values.city = frm.doc.city;
		values.state = frm.doc.state;
		values.country = frm.doc.country;

		// custom fields — same fieldname on both sides
		[
			"custom_approx_annual_requirement",
			"custom_requirement_timeline",
			"custom_product_group",
			"custom_application",
			"custom_industry_ct",
			"custom_customer_type",
			"custom_product_intrest",
		].forEach((fieldname) => copy_custom_field(values, "Opportunity", frm, fieldname));

		// renamed on Lead (trailing underscore) vs Opportunity
		copy_custom_field(values, "Opportunity", frm, "custom_annual_turnover_", "custom_annual_turnover");
		copy_custom_field(values, "Opportunity", frm, "custom_application_description_", "custom_application_description");

		route_to_new_doc("Opportunity", values);
	});
}


/* ---------------------------------------------------------------------
 * Quotation
 * ------------------------------------------------------------------- */
function override_quotation_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Quotation", "Create");
	frm.add_custom_button(__("Quotation"), () => make_quotation_from_lead(frm), __("Create"));
}

function make_quotation_from_lead(frm) {
	frappe.model.with_doctype("Quotation", () => {
		let values = {};

		// same ordering concern as Opportunity: quotation_to before party_name
		values.quotation_to = "Lead";
		values.party_name = frm.doc.name;
		values.customer_name = frm.doc.company_name || frm.doc.lead_name;

		// custom fields — same fieldname on both sides
		[
			"custom_customer_type",
			"custom_industry_ct",
			"custom_application",
			"custom_product_group",
			"custom_product_intrest",
		].forEach((fieldname) => copy_custom_field(values, "Quotation", frm, fieldname));

		// renamed on Lead (trailing underscore) vs Quotation
		copy_custom_field(values, "Quotation", frm, "custom_application_description_", "custom_application_description");

		route_to_new_doc("Quotation", values);
	});
}


/* ---------------------------------------------------------------------
 * Customer
 * ------------------------------------------------------------------- */
function override_customer_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Customer", "Create");
	frm.add_custom_button(__("Customer"), () => make_customer_from_lead(frm), __("Create"));
}

function make_customer_from_lead(frm) {
	frappe.model.with_doctype("Customer", () => {
		let values = {};

		values.customer_name = frm.doc.company_name || frm.doc.lead_name;
		values.lead_name = frm.doc.name; // back-link to originating lead
		values.territory = frm.doc.territory;

		copy_custom_field(values, "Customer", frm, "custom_customer_type", "custom_customer__type");
		copy_custom_field(values, "Customer", frm, "custom_industry_ct", "custom_industrys");
		copy_custom_field(values, "Customer", frm, "custom_application"); // same fieldname on both sides

		route_to_new_doc("Customer", values);
	});
}