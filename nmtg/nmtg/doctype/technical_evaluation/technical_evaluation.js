// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.ui.form.on("Technical Evaluation Item", {
    // Fires when a grid row is expanded/opened
    form_render(frm, cdt, cdn) {
        set_competitor_name_options(frm, cdt, cdn);
        set_competitor_model_options(frm, cdt, cdn);
    },

    // fires for every existing row when the child table is rendered (e.g. on form load)
    items_render(frm, cdt, cdn) {
        set_competitor_name_options(frm, cdt, cdn);
        set_competitor_model_options(frm, cdt, cdn);
    },

    product_group(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        frappe.model.set_value(cdt, cdn, "competitor_name", "");
        frappe.model.set_value(cdt, cdn, "competitor_model", "");
        frappe.model.set_value(cdt, cdn, "nmtg_model", "");
        update_select_field_options(frm, cdt, cdn, "competitor_model", [""]);
        set_competitor_name_options(frm, cdt, cdn);
    },

    competitor_name(frm, cdt, cdn) {
        frappe.model.set_value(cdt, cdn, "competitor_model", "");
        frappe.model.set_value(cdt, cdn, "nmtg_model", "");
        set_competitor_model_options(frm, cdt, cdn);
    },

    competitor_model(frm, cdt, cdn) {
        set_nmtg_model_from_competitor_model(frm, cdt, cdn);
    },

    clarification_required: function(frm, cdt, cdn) {
        toggle_questionary_visibility(frm);
    },
    items_remove: function(frm) {
        toggle_questionary_visibility(frm);
    },
    request_no: function(frm) {
        set_request_no_options(frm);
    },
    create_feasibility_review: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (row.feasibility_review_report) {
            frappe.set_route("Form", "Feasibility Review Report", row.feasibility_review_report);
            return;
        }

        if (!row.item_code) {
            frappe.msgprint(__("Please set Item Code before creating a Feasibility Review."));
            return;
        }

        frappe.confirm(
            __("Create a new Feasibility Review Report for this item?"),
            function() {
                const categories = [
                    "Technical Capability",
                    "Infrastructure Feasibility",
                    "Existing Work Load Vs Time Line",
                    "Staff",
                    "Budgets & Financial Matters",
                    "Other",
                    "Statutory & Regulatory Requirements"
                ];

                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Feasibility Review Report",
                            customer: frm.doc.customer,
                            customer_part_no: row.item_code,
                            ref_customer_document_no: frm.doc.name,
                            ref_enquiry: frm.doc.opportunity_no,
                            prepared_by: frappe.session.user,
                            date: frappe.datetime.get_today(),
                            feasibility_checkpoints: categories.map(cat => ({ category: cat })),
                            customer_part_name:row.item_name
                        }
                    },
                    freeze: true,
                    freeze_message: __("Creating Feasibility Review Report..."),
                    callback: function(r) {
                        if (r.message) {
                            frappe.model.set_value(cdt, cdn, "feasibility_review_report", r.message.name);

                            frm.save().then(() => {
                                frappe.show_alert({
                                    message: __("Feasibility Review Report {0} created", [r.message.name]),
                                    indicator: "green"
                                });
                                frappe.set_route("Form", "Feasibility Review Report", r.message.name);
                            });
                        }
                    }
                });
            }
        );
    },
    download_apqp: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        frappe.call({
            method: "nmtg.override.api.generate_apqp_template",
            args: { parent: frm.doc.name, item_row: row.name },
            freeze: true,
            freeze_message: __("Generating APQP..."),
            callback: function(r) {
                if (r.message) {
                    window.open(r.message);
                }
            }
        });
    }
});

frappe.ui.form.on(cur_frm ? cur_frm.doctype : "Technical Evaluation", {
    refresh(frm) {
        (frm.doc.items || []).forEach(row => {
            set_competitor_name_options(frm, row.doctype, row.name);
            set_competitor_model_options(frm, row.doctype, row.name);
        });
        toggle_questionary_visibility(frm);
        set_request_no_options(frm);
    },
     
    items_add: function(frm) {
        set_request_no_options(frm);
    },
    items_remove: function(frm) {
        set_request_no_options(frm);
    },
    onload: function (frm) {
		if (frm.is_new() && !frm.doc.lead_engineer) {
			frm.set_value("lead_engineer", frappe.session.user);
		}
	},
	send_questionary_to_customer: function (frm) {
		if (frm.is_new()) {
			frappe.msgprint(__("Please save the document before sending the questionary."));
			return;
		}

		if (
			!frm.doc.questionary_for_technical_evaluation ||
			!frm.doc.questionary_for_technical_evaluation.length
		) {
			frappe.msgprint(
				__("Please add at least one row in Questionary For Technical Evaluation before sending.")
			);
			return;
		}

		if (!frm.doc.email) {
			frappe.msgprint(__("Please set the Email field before sending the questionary."));
			return;
		}

		frappe.confirm(
			__("Send the questionary link to {0}?", [frm.doc.email]),
			function () {
				frappe.call({
					method: "nmtg.override.api.send_technical_evaluation_questionary",
					args: { technical_evaluation: frm.doc.name },
					freeze: true,
					freeze_message: __("Sending..."),
					callback: function (r) {
						if (!r.exc) {
							frappe.show_alert({
								message: __("Questionary email sent to {0}", [frm.doc.email]),
								indicator: "green",
							});
							frm.reload_doc();
						}
					},
				});
			}
		);
	},
});


frappe.ui.form.on('Questionary For Technical Evaluation', {
    questionary_for_technical_evaluation_add: function(frm) {
        set_request_no_options(frm);
    }
});

function set_request_no_options(frm) {
    let request_nos = [...new Set(
        (frm.doc.items || [])
            .map(d => d.request_no)
            .filter(d => d)
    )];

    // Prepend a blank option so the field can start empty
    let options = [""].concat(request_nos).join('\n');

    frm.fields_dict['questionary_for_technical_evaluation'].grid.update_docfield_property(
        'request_no', 'options', options
    );

    frm.refresh_field('questionary_for_technical_evaluation');
}


// Step 1: Product Group -> Competitor Name options (distinct brands)
function set_competitor_name_options(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group) {
        update_select_field_options(frm, cdt, cdn, "competitor_name", [""]);
        return;
    }

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let options = [""];
        (pg_doc.competitor_model || []).forEach(r => {
            if (r.competitor_model && !options.includes(r.competitor_model)) {
                options.push(r.competitor_model);
            }
        });
        update_select_field_options(frm, cdt, cdn, "competitor_name", options);
    });
}

// Step 2: Product Group + Competitor Name -> Competitor Model options
function set_competitor_model_options(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group || !row.competitor_name) {
        update_select_field_options(frm, cdt, cdn, "competitor_model", [""]);
        return;
    }

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let options = [""];
        (pg_doc.competitor_model || []).forEach(r => {
            if (r.competitor_model !== row.competitor_name) return;
            if (r.competitor_model_name && !options.includes(r.competitor_model_name)) {
                options.push(r.competitor_model_name);
            }
        });
        update_select_field_options(frm, cdt, cdn, "competitor_model", options);
    });
}

// Step 3: Product Group + Competitor Name + Competitor Model -> auto-fill NMTG Model
function set_nmtg_model_from_competitor_model(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group || !row.competitor_name || !row.competitor_model) return;

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let match = (pg_doc.competitor_model || []).find(r =>
            r.competitor_model === row.competitor_name &&
            r.competitor_model_name === row.competitor_model
        );
        if (match) {
            frappe.model.set_value(cdt, cdn, "nmtg_model", match.model);
        }
    });
}

// Generic helper to push new Select options into a grid row's inline + expanded editors
function update_select_field_options(frm, cdt, cdn, fieldname, options) {
    let row = locals[cdt][cdn];
    let options_str = options.join("\n");

    let grid = frm.fields_dict[row.parentfield].grid;
    let grid_row = grid.grid_rows_by_docname[cdn];
    if (!grid_row) return;

    // 1. update the row's own docfield definition
    let docfield = grid_row.docfields.find(df => df.fieldname === fieldname);
    if (docfield) docfield.options = options_str;

    // 2. update the grid-level column template (governs newly created inline cell editors)
    let grid_field = grid.get_field(fieldname);
    if (grid_field && grid_field.df) grid_field.df.options = options_str;

    // 3. force the INLINE cell control to rebuild
    if (grid_row.refresh_field) {
        grid_row.refresh_field(fieldname);
    } else if (grid_row.columns && grid_row.columns[fieldname]) {
        grid_row.columns[fieldname].df.options = options_str;
        grid_row.columns[fieldname].field &&
            grid_row.columns[fieldname].field.set_options &&
            grid_row.columns[fieldname].field.set_options(options_str);
    }

    // 4. if the expanded row-form is open, refresh that field too
    if (grid_row.grid_form && grid_row.grid_form.fields_dict[fieldname]) {
        grid_row.grid_form.fields_dict[fieldname].df.options = options_str;
        grid_row.grid_form.fields_dict[fieldname].refresh();
    }
}

function toggle_questionary_visibility(frm) {
    const has_clarification = (frm.doc.items || []).some(
        row => row.clarification_required === 'Yes'
    );

    frm.toggle_display('questionary_for_technical_evaluation', has_clarification);
    frm.toggle_display('send_questionary_to_customer', has_clarification);
    frm.refresh_field('questionary_for_technical_evaluation');
}

