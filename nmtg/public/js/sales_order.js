frappe.ui.form.on("Sales Order", {
    party_name: function (frm) {
        set_dealer_from_customer(frm);
    },
    
    refresh: function (frm) {
		recalculate_all_commissions(frm);
		setup_dealer_liason_query(frm);

        if (frm.doc.quotation_to === "Customer" && frm.doc.customer) {
            set_dealer_from_customer(frm);
        };
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
    before_workflow_action: function (frm) {
		const action = frm.selected_workflow_action;

		const action_field_map = {
			"On Hold": {
				fieldname: "custom_on_hold_remark",
				dialog_title: __("Reason for Hold"),
				field_label: __("Remark"),
			},
			"Unhold SO": {
				fieldname: "custom_unhold_remark",
				dialog_title: __("Unhold Remark"),
				field_label: __("Remark"),
			},
		};

		const config = action_field_map[action];

		if (!config) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
		
			frappe.dom.unfreeze();

			let settled = false;

			const dialog = new frappe.ui.Dialog({
				title: config.dialog_title,
				fields: [
					{
						fieldname: "remark",
						fieldtype: "Small Text",
						label: config.field_label,
						reqd: 1,
					},
				],
				primary_action_label: __("Continue"),
				primary_action: function (values) {
					dialog.get_primary_btn().prop("disabled", true).text(__("Saving..."));
					frappe.db
						.set_value(frm.doctype, frm.docname, config.fieldname, values.remark)
						.then(() => {
							
							frm.doc[config.fieldname] = values.remark;
							frm.refresh_field(config.fieldname);

							settled = true;
							dialog.hide();
							resolve();
						})
						.catch((err) => {
							settled = true;
							dialog.hide();
							frappe.msgprint({
								title: __("Could Not Save Remark"),
								message: __(
									"The remark could not be saved, so the {0} action was cancelled.",
									[action]
								),
								indicator: "red",
							});
							reject(err);
						});
				},

				on_hide: function () {
					if (!settled) {
						settled = true;
						frappe.show_alert({
							message: __("{0} action cancelled — no remark was entered.", [action]),
							indicator: "orange",
						});
						reject(new Error("Workflow action cancelled: remark not provided."));
					}
				},
			});

			dialog.show();
		});
	},
});

function set_dealer_from_customer(frm) {
    if (frm.doc.quotation_to !== "Customer" || !frm.doc.party_name) {
        frm.set_value("custom_dealer_name", null);
        return;
    }

    frappe.db.get_value("Customer", frm.doc.party_name, "custom_dealer")
        .then((r) => {
            const dealer = r && r.message ? r.message.custom_dealer : null;
            frm.set_value("custom_dealer_name", dealer || null);
        });
}


frappe.ui.form.on('Dealer Liason CT', {
    commission_: function(frm, cdt, cdn) {
        calculate_commission_amount(frm, cdt, cdn);
    },
    dealer__liason: function(frm, cdt, cdn) {
        calculate_commission_amount(frm, cdt, cdn);
		let row = locals[cdt][cdn];
        frappe.model.set_value(cdt, cdn, "dealer__liason_name", "");
        setup_dealer_liason_query(frm);
    },
    third_party_commission_: function(frm, cdt, cdn) {
        calculate_third_party_commission_amount(frm, cdt, cdn);
    }
	
});


function setup_dealer_liason_query(frm) {
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

function calculate_commission_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let total = flt(frm.doc.total);

    row.commission_amount = flt(
        total * flt(row.commission_) / 100,
        precision('commission_amount', row)
    );

    calculate_third_party_commission_amount(frm, cdt, cdn);

    frm.refresh_field('custom_dealer__liason');
}

function calculate_third_party_commission_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    row.third_party_commission_amount = flt(
        flt(row.commission_amount) * flt(row.third_party_commission_) / 100,
        precision('third_party_commission_amount', row)
    );

    frm.refresh_field('custom_dealer__liason');
}

function recalculate_all_commissions(frm) {
    (frm.doc.custom_dealer__liason || []).forEach(function(row) {
        let total = flt(frm.doc.total);

        row.commission_amount = flt(
            total * flt(row.commission_) / 100,
            precision('commission_amount', row)
        );

        row.third_party_commission_amount = flt(
            flt(row.commission_amount) * flt(row.third_party_commission_) / 100,
            precision('third_party_commission_amount', row)
        );
    });
    frm.refresh_field('custom_dealer__liason');
}
