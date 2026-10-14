frappe.ui.form.on('Supplier', {
    before_workflow_action: function(frm) {
        if (frm.selected_workflow_action === 'Reject') {
            frappe.dom.unfreeze();

            return new Promise((resolve, reject) => {
                let submitted = false;

                const d = new frappe.ui.Dialog({
                    title: 'Reason for Rejection',
                    fields: [
                        {
                            fieldname: 'custom_rejection_remark',
                            fieldtype: 'Small Text',
                            label: 'Rejection Remark',
                            reqd: 1
                        }
                    ],
                    primary_action_label: 'Submit Rejection',
                    primary_action: function(values) {
                        submitted = true;
                        frappe.call({
                            method: 'nmtg.override.api.custom_set_rejection_remark',
                            args: {
                                name: frm.docname,
                                remark: values.custom_rejection_remark
                            },
                            callback: function() {
                                d.hide();
                                resolve();
                            }
                        });
                    }
                });

                d.$wrapper.on('hidden.bs.modal', () => {
                    if (!submitted) {
                        frappe.show_alert({ message: 'Rejection cancelled — remark is required', indicator: 'orange' });
                        reject();
                    }
                });

                d.show();
            });
        }
    },

    refresh: function(frm) {
        if (
            !frm.is_new() &&
            frm.doc.custom_supplier_status !== "Approved Supplier" &&
            !frm.doc.custom_supplier_form_sent
        ) {
            frm.add_custom_button("Send Supplier Forms", function () {
                if (!frm.doc.email_id) {
                    frappe.msgprint("Please set a Primary Contact with an Email ID first.");
                    return;
                }
                frappe.confirm(
                    `Send Supplier Audit Form and Registration Form to <b>${frm.doc.email_id}</b>?`,
                    function () {
                        frappe.call({
                            method: "nmtg.override.supplier.send_supplier_forms",
                            args: { supplier: frm.doc.name },
                            freeze: true,
                            freeze_message: "Sending...",
                            callback: function (r) {
                                if (r.exc) return;

                                // Persist the flag (works even though the field is read-only)
                                frappe.db.set_value(
                                    "Supplier",
                                    frm.doc.name,
                                    "custom_supplier_form_sent",
                                    1
                                ).then((res) => {
                                    // Update local doc without making it dirty
                                    frm.doc.custom_supplier_form_sent = 1;
                                    if (res && res.message && res.message.modified) {
                                        frm.doc.modified = res.message.modified;
                                    }
                                    frm.refresh_field("custom_supplier_form_sent");

                                    // Hide the button
                                    frm.remove_custom_button("Send Supplier Forms");

                                    frappe.show_alert({
                                        message: "Forms sent successfully",
                                        indicator: "green"
                                    });
                                });
                            },
                        });
                    }
                );
            });
        }

        if (frm.is_new()) return;

        frappe.call({
            method: "nmtg.override.supplier.get_computed_supplier_status",
            args: { supplier: frm.doc.name },
            callback(r) {
                if (r.message && r.message !== frm.doc.custom_supplier_status) {
                    frm.set_value("custom_supplier_status", r.message);
                }
            },
        });
    },
});