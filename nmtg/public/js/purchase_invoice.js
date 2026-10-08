frappe.ui.form.on("Purchase Invoice", {
    refresh(frm) {
        if (frm.doc.docstatus !== 1 || flt(frm.doc.outstanding_amount) <= 0) {
            return;
        }

        frm.remove_custom_button("Payment Request", "Create");

        frm.add_custom_button(
            __("Payment Request"),
            function () {
                show_pi_payment_term_dialog(frm);
            },
            __("Create")
        );
    }
});


async function show_pi_payment_term_dialog(frm) {

    // Purchase Orders linked through the invoice items
    const po_list = [];
    (frm.doc.items || []).forEach(row => {
        if (row.purchase_order && !po_list.includes(row.purchase_order)) {
            po_list.push(row.purchase_order);
        }
    });

    if (!po_list.length) {
        frappe.msgprint({
            title: __("No Purchase Order"),
            message: __("This Purchase Invoice is not linked to any Purchase Order, so there are no payment terms to pick from."),
            indicator: "orange"
        });
        return;
    }

    // Payment terms of each linked PO
    const terms_by_po = {};
    try {
        for (const po_name of po_list) {
            const po = await frappe.db.get_doc("Purchase Order", po_name);
            terms_by_po[po_name] = (po.payment_schedule || [])
                .filter(row => row.payment_term)
                .map(row => row.payment_term);
        }
    } catch (e) {
        frappe.msgprint(__("Could not load the Purchase Order payment terms."));
        return;
    }

    const first_po = po_list[0];

    const dialog = new frappe.ui.Dialog({
        title: __("Create Payment Request"),

        fields: [
            {
                fieldname: "purchase_order",
                fieldtype: "Select",
                label: __("Purchase Order"),
                options: po_list.join("\n"),
                default: first_po,
                reqd: 1,
                hidden: po_list.length === 1 ? 1 : 0,
                onchange() {
                    const po = dialog.get_value("purchase_order");
                    dialog.set_df_property("payment_term", "options", (terms_by_po[po] || []).join("\n"));
                    dialog.set_value("payment_term", "");
                }
            },
            {
                fieldname: "payment_term",
                fieldtype: "Select",
                label: __("Payment Term"),
                options: (terms_by_po[first_po] || []).join("\n"),
                reqd: 1
            }
        ],

        primary_action_label: __("Create Payment Request"),

        primary_action(values) {

            if (!values.payment_term) {
                frappe.msgprint(__("Please select a Payment Term."));
                return;
            }

            dialog.hide();

            frappe.call({
                method: "nmtg.override.payment_request.create_pi_payment_request",

                args: {
                    pi: frm.doc.name,
                    po: values.purchase_order,
                    payment_term: values.payment_term
                },

                freeze: true,

                freeze_message: __("Creating Payment Request..."),

                callback: function (r) {

                    if (!r.message) {
                        return;
                    }

                    frappe.show_alert({
                        message: __("Payment Request {0} created", [r.message]),
                        indicator: "green"
                    });

                    frappe.set_route("Form", "Payment Request", r.message);
                }
            });
        }
    });

    dialog.show();
}