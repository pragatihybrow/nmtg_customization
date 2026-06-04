frappe.ui.form.on('Material Request', {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            // Remove default Make RFQ button and replace with ours
            frm.remove_custom_button('Request for Quotation', 'Create');

            frm.add_custom_button(__('Request for Quotation'), function() {
                frappe.call({
                    method: 'nmtg.override.material_request.make_rfq_with_suppliers',
                    args: {
                        source_name: frm.doc.name
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.model.sync(r.message);
                            frappe.set_route(
                                'Form',
                                'Request for Quotation',
                                r.message.name
                            );
                        }
                    }
                });
            }, __('Create'));
        }
    }
});