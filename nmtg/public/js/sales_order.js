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

    if (frm.is_new()) return;

    let has_pending = (frm.doc.items || []).some(
        it => it.drawing_approval_required === "Yes" && !it.drawing_email_sent
    );

    if (has_pending) {
        frm.add_custom_button("Send Drawing Verification Emails", function() {
            frappe.confirm(
                "Send drawing verification emails for all pending items in this document?",
                () => {
                    frappe.call({
                        method: "nmtg.override.api.send_drawing_verification_emails_for_doc",
                        args: { docname: frm.doc.name },
                        freeze: true,
                        freeze_message: "Sending emails...",
                        callback: function(r) {
                            if (!r.exc && r.message) {
                                let sent = r.message.sent || [];
                                let skipped = r.message.skipped || [];

                                let summary = `<b>Sent:</b> ${sent.length}`;
                                if (skipped.length) {
                                    summary += `<br><b>Skipped (no recipient/attachment):</b> ${skipped.length}<br>${skipped.join("<br>")}`;
                                }

                                frappe.msgprint({
                                    title: "Drawing Verification Emails",
                                    message: summary,
                                    indicator: sent.length ? "green" : "orange"
                                });

                                frm.reload_doc();
                            }
                        }
                    });
                }
            );
        }).addClass("btn-primary");
    }
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


frappe.ui.form.on("Sales Order Item", {
    drawing_approval_required(frm, cdt, cdn) {
        render_attachment_slots(frm, cdt, cdn);
    },
    form_render(frm, cdt, cdn) {
        render_attachment_slots(frm, cdt, cdn);
    },
    attachment_qty(frm, cdt, cdn) {
        sync_attachment_rows(frm, cdt, cdn);
        render_attachment_slots(frm, cdt, cdn);
    },
});

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


// Attachments are now keyed off the item row's own docname (cdn) instead
// of a request_no field, since Sales Order Item has no request_no.
function sync_attachment_rows(frm, cdt, cdn) {
    let linked = (frm.doc.attachment || []).filter(a => a.item_row === cdn);
    let qty = cint(locals[cdt][cdn].attachment_qty);

    if (linked.length > qty) {
        let to_remove = linked.slice(qty).filter(a => !a.attachment);
        to_remove.forEach(a => frm.get_field("attachment").grid.grid_rows_by_docname[a.name].remove());
    }
    frm.refresh_field("attachment");
}


function get_html_wrapper(frm, cdt, cdn) {
    let grid_row = frm.fields_dict["items"].grid.grid_rows_by_docname[cdn];
    if (!grid_row) return null;

    // The HTML field only exists once the row's detail form has been opened/rendered
    if (!grid_row.grid_form || !grid_row.grid_form.fields_dict) return null;

    let field = grid_row.grid_form.fields_dict["attachment"];
    if (!field || !field.$wrapper) return null;

    return field.$wrapper;
}


function render_attachment_slots(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let $wrapper = get_html_wrapper(frm, cdt, cdn);
    if (!$wrapper) return;

    $wrapper.empty();

    if (row.drawing_approval_required !== "Yes" || !row.attachment_qty) {
        $wrapper.append(`<div class="text-muted" style="font-size:12px;">Set "Drawing Approval Required" to Yes and enter Attachment Qty to add files.</div>`);
        return;
    }

    let existing = (frm.doc.attachment || []).filter(a => a.item_row === cdn);
    let $container = $('<div style="display:flex;flex-wrap:wrap;gap:8px;"></div>').appendTo($wrapper);

    for (let i = 0; i < cint(row.attachment_qty); i++) {
        let existing_row = existing[i];
        let $slot = $(`
            <div style="border:1px solid var(--border-color);padding:6px 10px;border-radius:6px;min-width:140px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Attachment ${i + 1}</div>
                <button class="btn btn-xs btn-default attach-btn" type="button">
                    ${existing_row ? "Replace" : "Upload"}
                </button>
                ${existing_row ? `<a href="${existing_row.attachment}" target="_blank" style="margin-left:6px;font-size:12px;">View</a>` : ""}
            </div>
        `);

        $slot.find(".attach-btn").on("click", () => {
            new frappe.ui.FileUploader({
                doctype: frm.doctype,
                docname: frm.doc.name,
                folder: "Home/Attachments",
                on_success: (file_doc) => {
                    if (existing_row) {
                        existing_row.attachment = file_doc.file_url;
                    } else {
                        let child = frm.add_child("attachment");
                        child.item_row = cdn;
                        child.attachment = file_doc.file_url;
                    }
                    frm.refresh_field("attachment");
                    render_attachment_slots(frm, cdt, cdn);
                }
            });
        });

        $container.append($slot);
    }
}