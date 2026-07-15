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
        // reflect the remark on screen after a workflow reload
        if (frm.doc.custom_rejection_remark) {
            frm.refresh_field('custom_rejection_remark');
        }
    }
});