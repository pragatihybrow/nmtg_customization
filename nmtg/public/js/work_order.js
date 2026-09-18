frappe.ui.form.on("Work Order", {
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
       refresh: function(frm) {
        if (frm.doc.__islocal && frm.doc.sales_order && frm.doc.production_item
            && (!frm.doc.custom_customer_rquirements || frm.doc.custom_customer_rquirements.length === 0)) {

            frappe.call({
                method: "nmtg.override.api.get_customer_requirements_for_wo",
                args: {
                    sales_order: frm.doc.sales_order,
                    item_code: frm.doc.production_item
                },
                callback: function(r) {
                    if (r.message && r.message.length) {
                        frm.clear_table("custom_customer_rquirements");
                        r.message.forEach(function(row) {
                            let child = frm.add_child("custom_customer_rquirements");
                            Object.assign(child, row);
                        });
                        frm.refresh_field("custom_customer_rquirements");
                    }
                }
            });
        }
    }
});