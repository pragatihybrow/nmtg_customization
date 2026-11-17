frappe.ui.form.on("Sales Invoice", {
    refresh: function (frm) {
        setup_dealer_liason_type(frm);
        recalculate_all_commissions(frm);
        setup_dealer_liason_query(frm);

        if (frm.doc.quotation_to === "Customer" && frm.doc.party_name && !frm.doc.custom_dealer_name) {
            set_dealer_from_customer(frm);
        }
        if (frm.doc.docstatus !== 0 || frm.is_new()) {
            return;
        }

        frm.add_custom_button(__("Quotation History"), () => {
            if (!frm.doc.party_name && !frm.doc.customer_name) {
                frappe.msgprint(__("Please select a customer first."));
                return;
            }

            frappe.route_options = {
                view_by: "Customer Wise",
                company: frm.doc.company,
                customer_name: frm.doc.customer_name || frm.doc.party_name
            };

            frappe.set_route(
                "query-report",
                "Quotation History Item wise & Customer wise"
            );
        }, __("View"));
    },

    onload_post_render: function (frm) {
        setup_dealer_liason_type(frm);
    },

    after_save: function (frm) {
        setup_dealer_liason_type(frm);
        sync_terms_to_master(frm);
    },

    custom_dealer__liason_add: function (frm) {
        setup_dealer_liason_type(frm);
    },

    custom_dealer__liason_on_form_rendered: function (frm) {
        setup_dealer_liason_type(frm);
    },

    total: function (frm) {
        recalculate_all_commissions(frm);
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
    // Only fetch the dealer when the quotation is against a Customer
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
    form_render: function (frm, cdt, cdn) {
        setup_dealer_liason_type(frm);
    },
    commission_: function (frm, cdt, cdn) {
        calculate_commission_amount(frm, cdt, cdn);
    },
    dealer__liason: function (frm, cdt, cdn) {
        calculate_commission_amount(frm, cdt, cdn);
        frappe.model.set_value(cdt, cdn, "dealer__liason_name", "");
        setup_dealer_liason_query(frm);
    },
    third_party_commission_: function (frm, cdt, cdn) {
        calculate_third_party_commission_amount(frm, cdt, cdn);
    }
});


// ---------------------------------------------------------------------------
// Dealer / Liason type: show "Dealer" in place of "Customer" in the
// custom_dealer__liason child table (stored value stays "Customer").
// ---------------------------------------------------------------------------
const DEALER_LIASON_OPTIONS = [
    { label: "Dealer", value: "Customer" },
    { label: "Liason", value: "Liason" },
];

function dealer_liason_formatter(value) {
    const opt = DEALER_LIASON_OPTIONS.find((o) => o.value === value);
    return opt ? __(opt.label) : (value || "");
}

function apply_dealer_liason_df(d) {
    if (!d || d.fieldname !== "dealer__liason") return;
    d.fieldtype = "Select";
    d.options = DEALER_LIASON_OPTIONS;
    d.formatter = dealer_liason_formatter;
}

function patch_dealer_liason_docfields(grid) {
    (grid.docfields || []).forEach(apply_dealer_liason_df);
    (grid.visible_columns || []).forEach(function (c) {
        apply_dealer_liason_df(c && c[0]);
    });
    apply_dealer_liason_df(grid.get_docfield("dealer__liason"));
    (grid.grid_rows || []).forEach(function (gr) {
        (gr.docfields || []).forEach(apply_dealer_liason_df);
        (gr.columns_list || []).forEach(function (c) {
            apply_dealer_liason_df(c && c.df);
        });
    });
}

function relabel_dealer_liason_cells(grid) {
    const $w = $(grid.wrapper);

    $w.find('.grid-static-col[data-fieldname="dealer__liason"] .static-area').each(function () {
        const $el = $(this);
        if ($el.text().trim() === "Customer") {
            $el.text(__("Dealer"));
        }
    });

    $w.find('select[data-fieldname="dealer__liason"] option[value="Customer"]').text(__("Dealer"));
}

function setup_dealer_liason_type(frm) {
    const field = frm.fields_dict.custom_dealer__liason;
    const grid = field && field.grid;
    if (!grid) return;

    patch_dealer_liason_docfields(grid);

    if (!grid.__dl_refresh_patched) {
        const orig_refresh = grid.refresh;
        grid.refresh = function () {
            patch_dealer_liason_docfields(grid);
            const result = orig_refresh.apply(this, arguments);
            patch_dealer_liason_docfields(grid);
            relabel_dealer_liason_cells(grid);
            return result;
        };
        grid.__dl_refresh_patched = true;
        grid.refresh();
    }

    relabel_dealer_liason_cells(grid);
    setTimeout(function () {
        relabel_dealer_liason_cells(grid);
    }, 300);
}


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
    (frm.doc.custom_dealer__liason || []).forEach(function (row) {
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


frappe.ui.form.on("Sales Invoice", {
    refresh(frm) {
        if (frm.doc.docstatus !== 1 || flt(frm.doc.outstanding_amount) <= 0) {
            return;
        }

        frm.remove_custom_button("Payment Request", "Create");

        frm.add_custom_button(
            __("Payment Request"),
            function () {
                show_si_payment_term_dialog(frm);
            },
            __("Create")
        );
    }
});


async function show_si_payment_term_dialog(frm) {

    // Sales Orders linked through the invoice items
    const so_list = [];
    (frm.doc.items || []).forEach(row => {
        if (row.sales_order && !so_list.includes(row.sales_order)) {
            so_list.push(row.sales_order);
        }
    });

    if (!so_list.length) {
        frappe.msgprint({
            title: __("No Sales Order"),
            message: __("This Sales Invoice is not linked to any Sales Order, so there are no payment terms to pick from."),
            indicator: "orange"
        });
        return;
    }

    // Payment terms of each linked SO
    const terms_by_so = {};
    try {
        for (const so_name of so_list) {
            const so = await frappe.db.get_doc("Sales Order", so_name);
            terms_by_so[so_name] = (so.payment_schedule || [])
                .filter(row => row.payment_term)
                .map(row => row.payment_term);
        }
    } catch (e) {
        frappe.msgprint(__("Could not load the Sales Order payment terms."));
        return;
    }

    const first_so = so_list[0];

    const dialog = new frappe.ui.Dialog({
        title: __("Create Payment Request"),

        fields: [
            {
                fieldname: "sales_order",
                fieldtype: "Select",
                label: __("Sales Order"),
                options: so_list.join("\n"),
                default: first_so,
                reqd: 1,
                hidden: so_list.length === 1 ? 1 : 0,
                onchange() {
                    const so = dialog.get_value("sales_order");
                    dialog.set_df_property("payment_term", "options", (terms_by_so[so] || []).join("\n"));
                    dialog.set_value("payment_term", "");
                }
            },
            {
                fieldname: "payment_term",
                fieldtype: "Select",
                label: __("Payment Term"),
                options: (terms_by_so[first_so] || []).join("\n"),
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
                method: "nmtg.override.payment_request.create_si_payment_request",

                args: {
                    si: frm.doc.name,
                    so: values.sales_order,
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