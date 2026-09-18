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