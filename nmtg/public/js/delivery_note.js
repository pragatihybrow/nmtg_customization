frappe.ui.form.on("Delivery Note", {
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
    custom_ld_percentage: function(frm) { calculate_ld_for_all_items(frm); },
    custom_ld_so: function(frm) { calculate_ld_for_all_items(frm); },
    custom_frequency: function(frm) { calculate_ld_for_all_items(frm); },
    refresh: function(frm) { calculate_ld_for_all_items(frm); },
    after_save: function (frm) {
        sync_terms_to_master(frm);
    },
});

frappe.ui.form.on("Delivery Note Item", {
    net_amount: function(frm, cdt, cdn) { calculate_ld_for_row(frm, cdt, cdn); },
    custom_actual_delivery_date: function(frm, cdt, cdn) { calculate_ld_for_row(frm, cdt, cdn); },
    custom_delivery_date: function(frm, cdt, cdn) { calculate_ld_for_row(frm, cdt, cdn); },
    items_remove: function(frm) { update_total_ld(frm); }
});

function get_ld_units(delay_days, frequency) {
    if (!delay_days || delay_days <= 0) return 0;
    if (frequency === "Per Week") {
        return Math.ceil(delay_days / 7);
    }
    return delay_days; // Per Day (default)
}

function calculate_ld_for_row(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!frm.doc.custom_ld_so) {
        frappe.model.set_value(cdt, cdn, "custom_total_ld", 0);
        update_total_ld(frm);
        return;
    }

    let promised_date = row.custom_delivery_date;
    let actual_date = row.custom_actual_delivery_date;

    if (!promised_date || !actual_date) {
        frappe.model.set_value(cdt, cdn, "custom_total_ld", 0);
        update_total_ld(frm);
        return;
    }

    // Swapped: delay_days = promised_date - actual_date
    let delay_days = frappe.datetime.get_diff(promised_date, actual_date);
    let units = get_ld_units(delay_days, frm.doc.custom_frequency);

    let percentage = flt(frm.doc.custom_ld_percentage);
    let net_amount = flt(row.net_amount);
    let ld_amount = flt((net_amount * percentage * units) / 100, precision("custom_total_ld", row));

    frappe.model.set_value(cdt, cdn, "custom_total_ld", ld_amount);
    update_total_ld(frm);
}

function calculate_ld_for_all_items(frm) {
    if (!frm.doc.items || !frm.doc.items.length) return;
    frm.doc.items.forEach(function(row) {
        calculate_ld_for_row(frm, row.doctype, row.name);
    });
}

function update_total_ld(frm) {
    let total_ld = 0;
    (frm.doc.items || []).forEach(function(row) {
        total_ld += flt(row.custom_total_ld);
    });
    frm.set_value("custom_total_lw", total_ld);
}


function sync_terms_to_master(frm) {
    if (!frm.doc.tc_name || !frm.doc.terms) return;

    frappe.db
        .get_value("Terms and Conditions", frm.doc.tc_name, "terms")
        .then((r) => {
            const master_terms = r && r.message ? r.message.terms : "";

            if ((master_terms || "") === (frm.doc.terms || "")) return;

            frappe.confirm(
                __(
                    "Terms were changed. Update the Terms and Conditions master <b>{0}</b> with these changes? This will apply to all new documents that use it.",
                    [frm.doc.tc_name]
                ),
                () => {
                    frappe.call({
                        method: "nmtg.override.quotation.update_terms_and_conditions",
                        args: {
                            tc_name: frm.doc.tc_name,
                            terms: frm.doc.terms,
                        },
                        freeze: true,
                        freeze_message: __("Updating Terms and Conditions..."),
                        callback: function (res) {
                            if (!res.exc) {
                                frappe.show_alert({
                                    message: __("Terms and Conditions {0} updated", [frm.doc.tc_name]),
                                    indicator: "green",
                                });
                            }
                        },
                    });
                }
            );
        });
}