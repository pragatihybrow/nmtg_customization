frappe.ui.form.on("Opportunity", {
	setup: function (frm) {
		frm.set_query("opportunity_from", function () {
			return {
				filters: {
					name: ["in", ["Customer", "Lead", "Enquiry"]],
				},
			};
		});
        frm.set_query("shipping_address_name", function (doc) {
			return {
				query: "frappe.contacts.doctype.address.address.address_query",
				filters: {
					link_doctype: doc.opportunity_from,
					link_name: doc.party_name,
					address_type: "Shipping",
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
		if (frm.doc.shipping_address_name && !frm.doc.custom_shipping_address) {
            fetch_shipping_address(frm);
        }
       
        setTimeout(() => {
            frm.remove_custom_button("Customer", "Create");
        }, 300);
         set_contact_email_from_primary(frm);
         set_dealer(frm);

         opp_setup_dealer_liason_type(frm);
         opp_setup_dealer_liason_query(frm);
         opp_recalculate_all_commissions(frm);
    },
    onload_post_render: function (frm) {
        opp_setup_dealer_liason_type(frm);
    },
    after_save: function (frm) {
        opp_setup_dealer_liason_type(frm);
    },
    custom_dealer__liason_add: function (frm) {
        opp_setup_dealer_liason_type(frm);
    },
    custom_dealer__liason_on_form_rendered: function (frm) {
        opp_setup_dealer_liason_type(frm);
    },
    total: function (frm) {
        opp_recalculate_all_commissions(frm);
    },
    status: function(frm) {
        update_technical_status(frm);
    },
	custom_assign_to_responsible_users: function (frm) {
        if (frm.is_new()) {
            frappe.msgprint(__("Please save the document first."));
            return;
        }
        frappe.call({
            method: "nmtg.override.api.assign_to_responsible_users",
            args: { doctype: frm.doc.doctype, docname: frm.doc.name },
            freeze: true,
            freeze_message: __("Assigning..."),
            callback: function () {
                frm.reload_doc();
            },
        });
    },
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
                set_contact_email_from_primary(frm);

	},
	 shipping_address_name: function(frm) {
        fetch_shipping_address(frm);
    },
    party_name(frm) {
		set_dealer(frm);
	},
	opportunity_from(frm) {
		set_dealer(frm);
	},
	onload(frm) {
		if (frm.is_new()) set_dealer(frm);
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

function fetch_shipping_address(frm) {
    if (!frm.doc.shipping_address_name) {
        frm.set_value("custom_shipping_address", "");
        return;
    }

    frappe.call({
        method: "frappe.contacts.doctype.address.address.get_address_display",
        args: {
            address_dict: frm.doc.shipping_address_name
        },
        callback: function(r) {
            if (r.message) {
                frm.set_value("custom_shipping_address", r.message);
            }
        }
    });
}



frappe.ui.form.on("Lead Contact Info", {
    primary_contact(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        // Only one primary contact at a time:
        // when this row is checked, uncheck all the others
        if (row.primary_contact) {
            (frm.doc.custom_contact || []).forEach((r) => {
                if (r.name !== row.name && r.primary_contact) {
                    frappe.model.set_value(r.doctype, r.name, "primary_contact", 0);
                }
            });
        }

        set_contact_email_from_primary(frm);
    },

    email_id(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        // If the primary row's email is edited, keep contact_email in sync
        if (row.primary_contact) {
            set_contact_email_from_primary(frm);
        }
    },

    custom_contact_remove(frm) {
        // If the primary row is deleted, re-evaluate
        set_contact_email_from_primary(frm);
    },
});

function set_contact_email_from_primary(frm) {
    const primary = (frm.doc.custom_contact || []).find(
        (r) => r.primary_contact && r.email_id
    );

    if (primary && frm.doc.contact_email !== primary.email_id) {
        frm.set_value("contact_email", primary.email_id);
    }
}


function set_dealer(frm) {
	if (frm.doc.opportunity_from !== "Customer" || !frm.doc.party_name) {
		frm.set_value("custom_dealer", "");
		return;
	}

	frappe.call({
		method: "nmtg.override.api.get_dealer_for_customer",
		args: { customer: frm.doc.party_name },
		callback(r) {
			frm.set_value("custom_dealer", r.message || "");
		},
	});
}


/* ---------- Enquiry (Opportunity): Dealer / Liason table ----------
   Stored value stays "Customer" / "Liason"; only the label shows "Dealer".
   Names are prefixed opp_ so they do not clash with the Quotation script. */

const OPP_DEALER_LIASON_OPTIONS = [
    { label: "Dealer", value: "Customer" },
    { label: "Liason", value: "Liason" },
];

function opp_dealer_liason_formatter(value) {
    const opt = OPP_DEALER_LIASON_OPTIONS.find((o) => o.value === value);
    return opt ? __(opt.label) : (value || "");
}

function opp_apply_dealer_liason_df(d) {
    if (!d || d.fieldname !== "dealer__liason") return;
    d.fieldtype = "Select";
    d.options = OPP_DEALER_LIASON_OPTIONS;
    d.formatter = opp_dealer_liason_formatter;
}

function opp_patch_dealer_liason_docfields(grid) {
    (grid.docfields || []).forEach(opp_apply_dealer_liason_df);
    (grid.visible_columns || []).forEach(function (c) {
        opp_apply_dealer_liason_df(c && c[0]);
    });
    opp_apply_dealer_liason_df(grid.get_docfield("dealer__liason"));
    (grid.grid_rows || []).forEach(function (gr) {
        (gr.docfields || []).forEach(opp_apply_dealer_liason_df);
        (gr.columns_list || []).forEach(function (c) {
            opp_apply_dealer_liason_df(c && c.df);
        });
    });
}

function opp_relabel_dealer_liason_cells(grid) {
    const $w = $(grid.wrapper);

    $w.find('.grid-static-col[data-fieldname="dealer__liason"] .static-area').each(function () {
        const $el = $(this);
        if ($el.text().trim() === "Customer") {
            $el.text(__("Dealer"));
        }
    });

    $w.find('select[data-fieldname="dealer__liason"] option[value="Customer"]').text(__("Dealer"));
}

function opp_setup_dealer_liason_type(frm) {
    const field = frm.fields_dict.custom_dealer__liason;
    const grid = field && field.grid;
    if (!grid) return;

    opp_patch_dealer_liason_docfields(grid);

    if (!grid.__opp_dl_refresh_patched) {
        const orig_refresh = grid.refresh;
        grid.refresh = function () {
            opp_patch_dealer_liason_docfields(grid);
            const result = orig_refresh.apply(this, arguments);
            opp_patch_dealer_liason_docfields(grid);
            opp_relabel_dealer_liason_cells(grid);
            return result;
        };
        grid.__opp_dl_refresh_patched = true;
        grid.refresh();
    }

    opp_relabel_dealer_liason_cells(grid);
    setTimeout(function () {
        opp_relabel_dealer_liason_cells(grid);
    }, 300);
}

function opp_setup_dealer_liason_query(frm) {
    frm.set_query("dealer__liason_name", "custom_dealer__liason", function (doc, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (row.dealer__liason === "Customer") {
            return {
                query: "nmtg.override.api.get_dealer_customers"
            };
        }
        return {};
    });
}

frappe.ui.form.on("Dealer Liason CT", {
    form_render: function (frm, cdt, cdn) {
        if (frm.doctype !== "Opportunity") return;
        opp_setup_dealer_liason_type(frm);
    },
    commission_: function (frm, cdt, cdn) {
        if (frm.doctype !== "Opportunity") return;
        opp_calculate_commission_amount(frm, cdt, cdn);
    },
    commission_amount: function (frm, cdt, cdn) {
        if (frm.doctype !== "Opportunity") return;
        opp_calculate_commission_percent(frm, cdt, cdn);
    },
    dealer__liason: function (frm, cdt, cdn) {
        if (frm.doctype !== "Opportunity") return;
        opp_calculate_commission_amount(frm, cdt, cdn);
        frappe.model.set_value(cdt, cdn, "dealer__liason_name", "");
        opp_setup_dealer_liason_query(frm);
    },
    third_party_commission_: function (frm, cdt, cdn) {
        if (frm.doctype !== "Opportunity") return;
        opp_calculate_third_party_commission_amount(frm, cdt, cdn);
    },
    third_party_commission_amount: function (frm, cdt, cdn) {
        if (frm.doctype !== "Opportunity") return;
        opp_calculate_third_party_commission_percent(frm, cdt, cdn);
    },
});

function opp_calculate_commission_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let total = flt(frm.doc.total);

    row.commission_amount = flt(
        total * flt(row.commission_) / 100,
        precision("commission_amount", row)
    );

    opp_calculate_third_party_commission_amount(frm, cdt, cdn);

    frm.refresh_field("custom_dealer__liason");
}

function opp_calculate_commission_percent(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let total = flt(frm.doc.total);

    row.commission_ = total ? flt(
        flt(row.commission_amount) * 100 / total,
        precision("commission_", row)
    ) : 0;

    opp_calculate_third_party_commission_amount(frm, cdt, cdn);

    frm.refresh_field("custom_dealer__liason");
}

function opp_calculate_third_party_commission_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    row.third_party_commission_amount = flt(
        flt(row.commission_amount) * flt(row.third_party_commission_) / 100,
        precision("third_party_commission_amount", row)
    );

    frm.refresh_field("custom_dealer__liason");
}

function opp_calculate_third_party_commission_percent(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let commission_amount = flt(row.commission_amount);

    row.third_party_commission_ = commission_amount ? flt(
        flt(row.third_party_commission_amount) * 100 / commission_amount,
        precision("third_party_commission_", row)
    ) : 0;

    frm.refresh_field("custom_dealer__liason");
}

function opp_recalculate_all_commissions(frm) {
    let changed = false;

    (frm.doc.custom_dealer__liason || []).forEach(function (row) {
        let total = flt(frm.doc.total);

        let new_commission_amount = flt(
            total * flt(row.commission_) / 100,
            precision("commission_amount", row)
        );
        let new_third_party_commission_amount = flt(
            flt(new_commission_amount) * flt(row.third_party_commission_) / 100,
            precision("third_party_commission_amount", row)
        );

        if (row.commission_amount !== new_commission_amount) {
            row.commission_amount = new_commission_amount;
            changed = true;
        }
        if (row.third_party_commission_amount !== new_third_party_commission_amount) {
            row.third_party_commission_amount = new_third_party_commission_amount;
            changed = true;
        }
    });

    if (changed) {
        frm.refresh_field("custom_dealer__liason");
    }
}