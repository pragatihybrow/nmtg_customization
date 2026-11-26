const MODE_OF_TRANSPORT_OPTIONS = ["Air", "Road", "Ship"];
const MODE_OF_TRANSPORT_FIELD = "custom_mode_of_transportation";

frappe.ui.form.on("Quotation", {
    onload: function(frm) {
        if (frm.is_new()) {
            set_valid_till(frm);
        }
    },

    transaction_date: function(frm) {
        set_valid_till(frm);
    },

    setup: function (frm) {
        frm.email_field = "contact_email";

        frm.set_query("quotation_to", function () {
            return {
                filters: {
                    name: ["in", ["Customer", "Lead", "Enquiry"]],
                },
            };
        });
        frm.set_query("custom_select_freight_and_forwarder", function () {
            const transporters = frm.transporter_suppliers || [];
            return {
                filters: {
                    name: ["in", transporters.length ? transporters : ["__none__"]],
                    disabled: 0
                }
            };
        });

        frm.set_query("custom_freight_and_forwarder", function () {
            const selected = get_selected_forwarders(frm);
            return {
                filters: {
                    name: ["in", selected.length ? selected : ["__none__"]]
                }
            };
        });
    },
        custom_select_freight_and_forwarder(frm) {
        clear_forwarder_if_not_selected(frm);
        set_forwarder_emails(frm);
    },

    custom_select_freight_and_forwarder_remove(frm) {
        clear_forwarder_if_not_selected(frm);
        set_forwarder_emails(frm);
    },

    set_contact_link: function (frm) {
        if (frm.doc.quotation_to == "Enquiry" && frm.doc.party_name) {
            frappe.dynamic_link = { doc: frm.doc, fieldname: "party_name", doctype: "Enquiry" };
        }
    },

    party_name: function (frm) {
        set_dealer_from_customer(frm);
        set_terms_from_customer(frm);
    },

    quotation_to: function (frm) {
        if (frm.doc.quotation_to !== "Customer") {
            frm.set_value("custom_dealer_name", null);
            frm.set_value("custom_dealer_email", null);
        }
    },

    onload_post_render: function (frm) {
        setup_dealer_liason_type(frm);
        lm_render(frm);
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
  
    [MODE_OF_TRANSPORT_FIELD](frm) {
        render_mode_of_transport_checkboxes(frm);
    },
   

    refresh: function (frm) {
        set_forwarder_emails(frm);
        setup_dealer_liason_type(frm);
        load_transporter_suppliers(frm);
        recalculate_all_commissions(frm);
        setup_dealer_liason_query(frm);
        set_valid_till(frm);
        lm_render(frm);
        render_mode_of_transport_checkboxes(frm);

        render_crm_notes(frm);
        render_crm_activities(frm);

        if (
            frm.doc.docstatus === 0 &&
            frm.doc.quotation_to === "Customer" &&
            frm.doc.party_name &&
            (!frm.doc.custom_dealer_name || !frm.doc.custom_dealer_email)
        ) {
            set_dealer_from_customer(frm);
        }

        if (frm.is_new() && frm.doc.quotation_to === "Customer" && frm.doc.party_name && !frm.doc.tc_name) {
            set_terms_from_customer(frm);
        }

        if (!frm.is_new() && frm.doc.custom_dealer_name) {
            frm.add_custom_button(__("Email Dealer"), () => email_dealer(frm));
        }

        if (frm.doc.docstatus !== 0 || frm.is_new()) {
            return;
        }

        // frm.add_custom_button(__("Quotation History"), () => {
        //     if (!frm.doc.party_name && !frm.doc.customer_name) {
        //         frappe.msgprint(__("Please select a customer first."));
        //         return;
        //     }

        //     frappe.route_options = {
        //         view_by: "Customer Wise",
        //         company: frm.doc.company,
        //         customer_name: frm.doc.customer_name || frm.doc.party_name
        //     };

        //     frappe.set_route(
        //         "query-report",
        //         "Quotation History Item wise & Customer wise"
        //     );
        // }, __("View"));

        frm.add_custom_button(
            __("Item-wise Sales History"),
            () => open_item_wise_sales_history(frm),
            __("View")
        );

        if (frm.doc.quotation_to === "Customer" && frm.doc.party_name) {
            frm.add_custom_button(
                __("Customer-wise Sales History"),
                () => open_customer_wise_sales_history(frm),
                __("View")
            );
        }

        frm.add_custom_button(
            __("Stock Balance"),
            () => open_stock_balance_for_items(frm),
            __("View")
        );

        add_item_wise_quotation_buttons(frm);

        show_pending_quotation_message(frm);
    },

    total: function(frm) {
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

    custom_add_freight: function (frm) {
        lm_add_freight(frm);
    },

    before_workflow_action: function (frm) {
        if (frm.selected_workflow_action !== 'Update') {
            return;
        }

        frappe.dom.unfreeze();

        return new Promise((resolve, reject) => {
            let submitted = false;

            const d = new frappe.ui.Dialog({
                title: __('Reason for Update'),
                fields: [
                    {
                        fieldname: 'custom_rejection_remark',
                        fieldtype: 'Small Text',
                        label: __('Updation Remark'),
                        reqd: 1
                    }
                ],
                primary_action_label: __('Submit'),
                primary_action: function (values) {
                    submitted = true;
                    d.disable_primary_action();

                    frappe.call({
                        method: 'nmtg.override.api.custom_set_rejection_remark',
                        args: {
                            doctype: frm.doctype,
                            name: frm.docname,
                            remark: values.custom_rejection_remark
                        },
                        callback: function () {
                            frm.doc.custom_rejection_remark = values.custom_rejection_remark;
                            d.hide();
                            resolve();
                        },
                        error: function () {
                            d.hide();
                            reject();
                        }
                    });
                }
            });

            d.$wrapper.on('hidden.bs.modal', () => {
                if (!submitted) {
                    frappe.show_alert({
                        message: __('Rejection cancelled — remark is required'),
                        indicator: 'orange'
                    });
                    reject();
                }
            });

            d.show();
        });
    },
});

function alias_notes_field(frm) {
    if (Object.getOwnPropertyDescriptor(frm.doc, "notes")) return;
    Object.defineProperty(frm.doc, "notes", {
        get: () => frm.doc.custom_note,
        set: (v) => { frm.doc.custom_note = v; },
        configurable: true,
        enumerable: false,
    });
}

function render_crm_notes(frm) {
    if (frm.is_new() || frm.doc.docstatus == 1) return;
    if (!frm.fields_dict.custom_notes_html) return;

    alias_notes_field(frm);

    const crm_notes = new erpnext.utils.CRMNotes({
        frm: frm,
        notes_wrapper: $(frm.fields_dict.custom_notes_html.wrapper),
    });
    crm_notes.refresh();
}

function render_crm_activities(frm) {
    if (frm.is_new() || frm.doc.docstatus == 1) return;
    if (!frm.fields_dict.custom_open_activities_html || !frm.fields_dict.custom_all_activities) return;

    alias_notes_field(frm);

    const crm_activities = new erpnext.utils.CRMActivities({
        frm: frm,
        open_activities_wrapper: $(frm.fields_dict.custom_open_activities_html.wrapper),
        all_activities_wrapper: $(frm.fields_dict.custom_all_activities.wrapper),
        form_wrapper: $(frm.wrapper),
    });
    crm_activities.refresh();
}

function email_dealer(frm) {
    if (frm.is_dirty()) {
        frappe.msgprint(__("Please save the quotation before emailing the dealer."));
        return;
    }

    if (!frm.doc.custom_dealer_email) {
        frappe.msgprint(
            __("No email found for dealer <b>{0}</b>. Please add an Email ID on the dealer's Customer record.", [
                frm.doc.custom_dealer_name,
            ])
        );
        return;
    }

    frappe.confirm(
        __("Send quotation <b>{0}</b> to dealer <b>{1}</b> at <b>{2}</b>?", [
            frm.doc.name,
            frm.doc.custom_dealer_name,
            frm.doc.custom_dealer_email,
        ]),
        () => {
            frappe.call({
                method: "nmtg.override.quotation.send_quotation_to_dealer",
                args: { name: frm.doc.name },
                freeze: true,
                freeze_message: __("Sending email..."),
                callback: function (r) {
                    if (!r.exc) {
                        frappe.show_alert({
                            message: __("Quotation emailed to {0}", [r.message || frm.doc.custom_dealer_email]),
                            indicator: "green",
                        });
                        frm.reload_doc();
                    }
                },
            });
        }
    );
}

function open_stock_balance_for_items(frm) {
    const item_codes = [
        ...new Set(
            (frm.doc.items || [])
                .map((row) => row.item_code)
                .filter((code) => !!code)
        ),
    ];

    if (!item_codes.length) {
        frappe.msgprint(__("No items found in this Quotation."));
        return;
    }

    const today = frappe.datetime.get_today();

    frappe.route_options = {
        company: frm.doc.company,
        from_date: frappe.datetime.add_months(today, -1),
        to_date: today,
        item_code: item_codes,
    };

    frappe.set_route("query-report", "Stock Balance");
}


function show_pending_quotation_message(frm) {
    const item_codes = [
        ...new Set((frm.doc.items || []).map((r) => r.item_code).filter(Boolean)),
    ];

    if (!item_codes.length) return;

    frappe.call({
        method: "nmtg.override.quotation.quotation_stock_allocation",
        args: {
            item_codes: item_codes.join(","),
            company: frm.doc.company,
            quotation: frm.doc.name,
        },
        callback(r) {
            if (frm.dashboard.clear_comment) frm.dashboard.clear_comment();

            const data = (r.message || []).filter((d) => d.quotations && d.quotations.length);
            if (!data.length) return;

            const esc = frappe.utils.escape_html;

            const this_qty = {};
            (frm.doc.items || []).forEach((row) => {
                this_qty[row.item_code] = (this_qty[row.item_code] || 0) + flt(row.stock_qty || row.qty);
            });

            const summary_style = "cursor:pointer;outline:none;padding:2px 0";

            let html = `
                <details>
                    <summary style="${summary_style}">
                        <b>${__("Other quotations without Delivery Note")}</b>
                        <span class="text-muted">(${data.length} ${__("items")})</span>
                    </summary>
                    <div style="margin-top:8px">`;

            data.forEach((d) => {
                const color = d.available < 0 ? "red" : "green";
                const need = this_qty[d.item_code] || 0;

                html += `
                    <details style="margin-bottom:8px">
                        <summary style="${summary_style}">
                            <b>${esc(d.item_code)}</b> &nbsp;|&nbsp;
                            ${__("Stock Available")}: <b>${d.in_stock}</b> |
                            ${__("Pending in other quotations")}: <b>${d.pending_total}</b> |
                            ${__("This quotation")}: <b>${need}</b> |
                            <span style="color:${color}"><b>${__("Balance")}: ${d.available}</b></span>
                        </summary>
                        <table class="table table-bordered" style="margin:6px 0 0 0;background:#fff">
                            <thead>
                                <tr>
                                    <th>${__("Quotation")}</th>
                                    <th>${__("Customer")}</th>
                                    <th>${__("Date")}</th>
                                    <th>${__("Status")}</th>
                                    <th style="text-align:right">${__("Qty")}</th>
                                    <th style="text-align:right">${__("Pending Delivery")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${d.quotations
                                    .map(
                                        (q) => `
                                    <tr>
                                        <td><a href="/app/quotation/${encodeURIComponent(q.quotation)}">${esc(q.quotation)}</a></td>
                                        <td>${esc(q.customer || "")}</td>
                                        <td>${frappe.datetime.str_to_user(q.date)}</td>
                                        <td>${esc(q.status || "")}${q.docstatus === 0 ? " (" + __("Draft") + ")" : ""}</td>
                                        <td style="text-align:right">${q.qty}</td>
                                        <td style="text-align:right">${q.pending_qty}</td>
                                    </tr>`
                                    )
                                    .join("")}
                            </tbody>
                        </table>
                    </details>`;
            });

            html += `
                    </div>
                </details>`;

            frm.dashboard.add_comment(html, "orange", true);
        },
    });
}

function set_dealer_from_customer(frm) {
    if (frm.doc.quotation_to !== "Customer" || !frm.doc.party_name) {
        if (frm.doc.custom_dealer_name) {
            frm.set_value("custom_dealer_name", null);
        }
        if (frm.doc.custom_dealer_email) {
            frm.set_value("custom_dealer_email", null);
        }
        return;
    }

    frappe.db.get_value("Customer", frm.doc.party_name, "custom_dealer")
        .then((r) => {
            const dealer = r && r.message ? r.message.custom_dealer : null;

            if ((dealer || null) !== (frm.doc.custom_dealer_name || null)) {
                frm.set_value("custom_dealer_name", dealer || null);
            }

            if (!dealer) {
                if (frm.doc.custom_dealer_email) {
                    frm.set_value("custom_dealer_email", null);
                }
                return;
            }

            frappe.db.get_value("Customer", dealer, "email_id").then((res) => {
                const email = res && res.message ? res.message.email_id : null;

                if ((email || null) !== (frm.doc.custom_dealer_email || null)) {
                    frm.set_value("custom_dealer_email", email || null);
                }
            });
        });
}

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

frappe.ui.form.on('Dealer Liason CT', {
    form_render: function(frm, cdt, cdn) {
        setup_dealer_liason_type(frm);
    },
    commission_: function(frm, cdt, cdn) {
        calculate_commission_amount(frm, cdt, cdn);
    },
    commission_amount: function(frm, cdt, cdn) {
        calculate_commission_percent(frm, cdt, cdn);
    },
    dealer__liason: function(frm, cdt, cdn) {
        calculate_commission_amount(frm, cdt, cdn);
        frappe.model.set_value(cdt, cdn, "dealer__liason_name", "");
        setup_dealer_liason_query(frm);
    },
    third_party_commission_: function(frm, cdt, cdn) {
        calculate_third_party_commission_amount(frm, cdt, cdn);
    },
    third_party_commission_amount: function(frm, cdt, cdn) {
        calculate_third_party_commission_percent(frm, cdt, cdn);
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

function calculate_commission_percent(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let total = flt(frm.doc.total);

    row.commission_ = total ? flt(
        flt(row.commission_amount) * 100 / total,
        precision('commission_', row)
    ) : 0;

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

function calculate_third_party_commission_percent(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let commission_amount = flt(row.commission_amount);

    row.third_party_commission_ = commission_amount ? flt(
        flt(row.third_party_commission_amount) * 100 / commission_amount,
        precision('third_party_commission_', row)
    ) : 0;

    frm.refresh_field('custom_dealer__liason');
}

function recalculate_all_commissions(frm) {
    let changed = false;

    (frm.doc.custom_dealer__liason || []).forEach(function(row) {
        let total = flt(frm.doc.total);

        let new_commission_amount = flt(
            total * flt(row.commission_) / 100,
            precision('commission_amount', row)
        );
        let new_third_party_commission_amount = flt(
            flt(new_commission_amount) * flt(row.third_party_commission_) / 100,
            precision('third_party_commission_amount', row)
        );

        if (row.commission_amount !== new_commission_amount) {
            row.commission_amount = new_commission_amount;
            changed = true;
        }
        if (row.third_party_commission_amount !== new_third_party_commission_amount) {
            row.third_party_commission_amount = new_third_party_commission_amount;
            changed = true;
        }
    });

    if (changed) {
        frm.refresh_field('custom_dealer__liason');
    }
}

function set_valid_till(frm) {
    if (!frm.doc.transaction_date) {
        return;
    }

    frm.set_value(
        "valid_till",
        frappe.datetime.add_days(frm.doc.transaction_date, 120)
    );
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

function set_terms_from_customer(frm) {
    if (frm.doc.quotation_to !== "Customer" || !frm.doc.party_name) return;

    frappe.db
        .get_value("Customer", frm.doc.party_name, "custom_terms")
        .then((r) => {
            const tc = r && r.message ? r.message.custom_terms : null;
            if (!tc) return;

            const empty_terms = (t) => !t || t === '<div class="ql-editor read-mode"><p><br></p></div>';

            const load_terms = () => {
                if (!empty_terms(frm.doc.terms)) return;
                frappe.db.get_value("Terms and Conditions", tc, "terms").then((res) => {
                    const text = res && res.message ? res.message.terms : "";
                    if (text) frm.set_value("terms", text);
                });
            };

            if (frm.doc.tc_name !== tc) {
                frm.set_value("tc_name", tc).then(() => setTimeout(load_terms, 500));
            } else {
                load_terms();
            }
        });
}



const LM_CONFIG = {
	logistic_doctype: "Logistic",
	box_filters: {
		item_group: "Consumables",
		custom_product_group: "Packing Material",
		custom_sub_product_group: "Wooden box",
		disabled: 0,
	},
	boxes_per_piece: 1, // Logistic record is per piece
	max_suggestions_per_item: 5,
	allowance_mm: 0, // extra clearance a piece needs inside the box, per side
	allow_two_boxes: true, // allow a set of 2 wooden boxes (same or different) when no single box holds the whole qty
	enforce_weight_limit: true, // wooden box Item.weight_per_unit = max load it can carry (kg)
	debounce_ms: 400,
	freight_account_name: "Freight and Forwarding Charges", // Account.account_name used for the freight tax row
};

frappe.ui.form.on("Quotation Item", {
	item_code(frm) {
		lm_render_debounced(frm);
	},
	qty(frm) {
		lm_render_debounced(frm);
	},
	uom(frm) {
		lm_render_debounced(frm);
	},
	conversion_factor(frm) {
		lm_render_debounced(frm);
	},
	items_remove(frm) {
		lm_render_debounced(frm);
	},
});

// ---------------------------------------------------------------- helpers

function lm_render_debounced(frm) {
	clearTimeout(frm.__lm_timer);
	frm.__lm_timer = setTimeout(() => lm_render(frm), LM_CONFIG.debounce_ms);
}

function lm_esc(v) {
	return frappe.utils.escape_html(v == null ? "" : String(v));
}

function lm_to_mm(value, uom) {
	const v = flt(value);
	switch ((uom || "MM").toLowerCase()) {
		case "cm":
		case "centimeter":
			return v * 10;
		case "m":
		case "meter":
		case "metre":
			return v * 1000;
		case "inch":
		case "in":
			return v * 25.4;
		case "foot":
		case "ft":
			return v * 304.8;
		default:
			return v; // MM
	}
}

function lm_to_kg(value, uom) {
	const v = flt(value);
	switch ((uom || "Kg").toLowerCase()) {
		case "gram":
		case "g":
		case "gm":
			return v / 1000;
		case "mg":
		case "milligram":
			return v / 1000000;
		case "tonne":
		case "ton":
		case "mt":
			return v * 1000;
		case "pound":
		case "lb":
			return v * 0.45359237;
		default:
			return v; // Kg
	}
}

function lm_box_dims(b) {
	const w = lm_to_mm(b.custom_width, b.custom_width_uom);
	const l = lm_to_mm(b.custom_tl, b.custom_total_length_uom);
	const h = lm_to_mm(b.custom_height, b.custom_height_uom);
	return w > 0 && l > 0 && h > 0 ? [w, l, h] : null;
}

function lm_permutations(a) {
	return [
		[a[0], a[1], a[2]],
		[a[0], a[2], a[1]],
		[a[1], a[0], a[2]],
		[a[1], a[2], a[0]],
		[a[2], a[0], a[1]],
		[a[2], a[1], a[0]],
	];
}

function lm_parse_size(text) {
	const out = [];
	const re = /(\d+(?:\.\d+)?)\s*(mm|cm|m|inch|in|ft)?(?![a-z])/gi;
	let m;
	while ((m = re.exec(text || "")) !== null) {
		out.push(lm_to_mm(parseFloat(m[1]), m[2] || "MM"));
	}
	return out.length === 3 && out.every((x) => x > 0) ? out : null;
}

function lm_fit_by_size(piece, box) {
	const p = piece.map((x) => x + 2 * LM_CONFIG.allowance_mm);
	let best = 0;
	lm_permutations(p).forEach((q) => {
		const n = Math.floor(box[0] / q[0]) * Math.floor(box[1] / q[1]) * Math.floor(box[2] / q[2]);
		if (n > best) best = n;
	});
	return best;
}

function lm_box_info(b, pieces) {
	const dims = lm_box_dims(b);
	if (!dims) return null;
	return {
		box: b,
		box_dims: dims,
		box_vol: dims[0] * dims[1] * dims[2],
		max_kg: LM_CONFIG.enforce_weight_limit ? lm_to_kg(b.weight_per_unit, b.weight_uom) : 0,
		fit: pieces.map((p) => lm_fit_by_size(p.dims, dims)), // how many of each piece fit alone
	};
}

// load as much of `left` (qty still to pack, per piece) as one wooden box can take
function lm_load_box(info, pieces, left) {
	let used = 0;
	let kg = 0;
	const load = pieces.map(() => 0);
	pieces.forEach((p, i) => {
		if (left[i] <= 0 || info.fit[i] < 1) return;
		let q = Math.min(left[i], Math.floor((1 - used) * info.fit[i] + 1e-9));
		if (info.max_kg > 0 && p.unit_kg > 0) {
			q = Math.min(q, Math.floor((info.max_kg - kg) / p.unit_kg + 1e-9));
		}
		if (q < 1) return;
		load[i] = q;
		used += q / info.fit[i];
		kg += q * p.unit_kg;
	});
	return { info, load, used, kg, count: load.reduce((t, q) => t + q, 0) };
}

function lm_suggest(boxes, pieces) {
	const infos = boxes.map((b) => lm_box_info(b, pieces)).filter(Boolean);
	const qtys = pieces.map((p) => p.qty);
	const piece_vol = pieces.reduce((t, p) => t + p.qty * p.dims[0] * p.dims[1] * p.dims[2], 0);
	const minus = (left, part) => left.map((q, i) => q - part.load[i]);
	const done = (left) => left.every((q) => q <= 0);
	const make = (parts) => {
		const total_vol = parts.reduce((t, x) => t + x.info.box_vol, 0);
		return { count: parts.length, parts, total_vol, fill: Math.min(100, (piece_vol * 100) / total_vol) };
	};

	const options = [];
	const not_single = [];

	// 1. everything in ONE wooden box
	infos.forEach((info) => {
		const part = lm_load_box(info, pieces, qtys);
		if (done(minus(qtys, part))) options.push(make([part]));
		else not_single.push(info);
	});

	// 2. everything in TWO wooden boxes (only boxes that cannot take it all alone, so both are needed)
	if (LM_CONFIG.allow_two_boxes) {
		for (let i = 0; i < not_single.length; i++) {
			for (let j = i; j < not_single.length; j++) {
				const orders = [[not_single[i], not_single[j]], [not_single[j], not_single[i]]];
				for (const [first, second] of orders) {
					const p1 = lm_load_box(first, pieces, qtys);
					const p2 = lm_load_box(second, pieces, minus(qtys, p1));
					if (p1.count && p2.count && done(minus(minus(qtys, p1), p2))) {
						options.push(make([p1, p2]));
						break;
					}
				}
			}
		}
	}

	options.sort((a, b) => a.count - b.count || a.total_vol - b.total_vol || b.fill - a.fill);
	return {
		options: options.slice(0, LM_CONFIG.max_suggestions_per_item),
		max_load: infos.reduce((m, x) => Math.max(m, x.max_kg), 0),
	};
}

// ---------------------------------------------------------------- data

async function lm_get_list(doctype, filters, fields) {
	const r = await frappe.call({
		method: "frappe.client.get_list",
		args: { doctype, filters, fields, limit_page_length: 0 },
	});
	return r.message || [];
}

// stock on hand (Bin.actual_qty, summed over the company's warehouses) per item code
async function lm_get_stock(company, codes) {
	const stock = {};
	codes = [...new Set((codes || []).filter(Boolean))];
	if (!codes.length) return stock;
	try {
		const filters = { item_code: ["in", codes] };
		if (company) {
			const whs = await lm_get_list("Warehouse", { company: company, is_group: 0 }, ["name"]);
			if (!whs.length) return stock;
			filters.warehouse = ["in", whs.map((w) => w.name)];
		}
		const bins = await lm_get_list("Bin", filters, ["item_code", "actual_qty"]);
		bins.forEach((b) => {
			stock[b.item_code] = (stock[b.item_code] || 0) + flt(b.actual_qty);
		});
	} catch (e) {
		console.error("lm_get_stock", e);
	}
	return stock;
}

const LM_BOX_FIELDS = [
	"name", "item_name", "custom_width", "custom_tl", "custom_height",
	"custom_width_uom", "custom_total_length_uom", "custom_height_uom",
	"weight_per_unit", "weight_uom",
];

async function lm_fetch(frm) {
	const all_rows = (frm.doc.items || []).filter((d) => d.item_code);
	const all_codes = [...new Set(all_rows.map((d) => d.item_code))];
	if (!all_codes.length) return { rows: [], boxes: [], stock: {} };

	// corrugated / wooden boxes added to the quotation by "Add Freight" are packing material - never pack them again
	const packing = await lm_get_list(
		"Item",
		{ name: ["in", all_codes], custom_product_group: LM_CONFIG.box_filters.custom_product_group },
		["name"]
	);
	const packing_codes = new Set(packing.map((p) => p.name));
	const rows = all_rows.filter((d) => !packing_codes.has(d.item_code));
	const codes = [...new Set(rows.map((d) => d.item_code))];
	if (!codes.length) return { rows: [], boxes: [], stock: {} };

	const [items, logistics, boxes] = await Promise.all([
		lm_get_list("Item", { name: ["in", codes] }, ["name", "item_name", "weight_per_unit", "weight_uom"]),
		lm_get_list(LM_CONFIG.logistic_doctype, { item_code: ["in", codes], docstatus: ["<", 2] }, [
			"name", "item_code", "select_corrugated_box", "corrugated_box_name",
			"corrugated_box_size", "weight",
		]),
		lm_get_list("Item", LM_CONFIG.box_filters, LM_BOX_FIELDS),
	]);

	const corr_codes = [...new Set(logistics.map((l) => l.select_corrugated_box).filter(Boolean))];
	const corr_items = corr_codes.length
		? await lm_get_list("Item", { name: ["in", corr_codes] }, LM_BOX_FIELDS)
		: [];
	const corr_map = {};
	corr_items.forEach((i) => (corr_map[i.name] = i));

	const item_map = {};
	items.forEach((i) => (item_map[i.name] = i));

	// one line per item code, quantities summed (in stock UOM)
	const agg = {};
	rows.forEach((d) => {
		const it = item_map[d.item_code] || {};
		const qty = flt(d.stock_qty) || flt(d.qty) * (flt(d.conversion_factor) || 1);
		const a = (agg[d.item_code] = agg[d.item_code] || {
			item_code: d.item_code,
			item_name: d.item_name || it.item_name,
			qty: 0,
			unit_kg: lm_to_kg(
				flt(d.weight_per_unit) || it.weight_per_unit,
				(flt(d.weight_per_unit) ? d.weight_uom : it.weight_uom) || it.weight_uom
			),
		});
		a.qty += qty;
	});

	const by_item = {};
	logistics.forEach((l) => {
		const corr = corr_map[l.select_corrugated_box];
		l.corr_dims = (corr && lm_box_dims(corr)) || lm_parse_size(l.corrugated_box_size);
		(by_item[l.item_code] = by_item[l.item_code] || []).push(l);
	});

	const result = Object.values(agg).map((a) => {
		a.total_kg = a.qty * a.unit_kg;
		a.mappings = by_item[a.item_code] || [];
		return a;
	});

	const stock = await lm_get_stock(frm.doc.company, [...corr_codes, ...boxes.map((b) => b.name)]);

	return { rows: result, boxes, stock };
}

// ---------------------------------------------------------------- render

function lm_fmt(n, d = 2) {
	return format_number(n, null, d);
}

// stock qty cell: green when stock covers the required qty, red otherwise
function lm_stock_html(stock, code, need) {
	const qty = flt((stock || {})[code]);
	const cls = qty >= flt(need) ? "text-success" : "text-danger";
	return `<b class="${cls}">${lm_fmt(qty, qty % 1 ? 2 : 0)}</b>`;
}

function lm_table(headers, body_rows) {
	return `<table class="table table-bordered table-sm" style="margin-bottom:8px">
		<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
		<tbody>${body_rows.join("")}</tbody></table>`;
}

// one piece type per item: the corrugated box of its (first) Logistic record
function lm_build_pieces(rows) {
	const pieces = [];
	const skipped = [];
	rows.forEach((r) => {
		const m = r.mappings.find((x) => x.select_corrugated_box && x.corr_dims);
		if (!m) {
			skipped.push({
				item_code: r.item_code,
				reason: r.mappings.length ? "corrugated box not selected or has no size" : "no Logistic record",
			});
			return;
		}
		pieces.push({
			item_code: r.item_code,
			item_name: r.item_name,
			dims: m.corr_dims,
			corr_code: m.select_corrugated_box,
			corr_name: m.corrugated_box_name,
			qty: r.qty * LM_CONFIG.boxes_per_piece,
			unit_kg: flt(m.weight) || r.unit_kg || 0,
		});
	});
	// biggest corrugated boxes first - they are placed first
	pieces.sort((x, y) => y.dims[0] * y.dims[1] * y.dims[2] - x.dims[0] * x.dims[1] * x.dims[2]);
	return { pieces, skipped };
}

function lm_mapping_html(rows, stock) {
	const body = [];
	rows.forEach((r) => {
		const item = `<a href="/app/item/${encodeURIComponent(r.item_code)}">${lm_esc(r.item_code)}</a><br>
			<span class="text-muted small">${lm_esc(r.item_name)}</span>`;
		if (!r.mappings.length) {
			body.push(`<tr><td>${item}</td><td colspan="9" class="text-muted">No Logistic record for this item.</td></tr>`);
			return;
		}
		const corr_qty = r.qty * LM_CONFIG.boxes_per_piece;
		r.mappings.forEach((m) => {
			body.push(`<tr>
				<td>${item}</td>
				<td><a href="/app/${frappe.router.slug(LM_CONFIG.logistic_doctype)}/${encodeURIComponent(m.name)}">${lm_esc(m.name)}</a></td>
				<td><a href="/app/item/${encodeURIComponent(m.select_corrugated_box || "")}">${lm_esc(m.select_corrugated_box)}</a></td>
				<td>${lm_esc(m.corrugated_box_name)}</td>
				<td>${lm_esc(m.corrugated_box_size)}</td>
				<td class="text-right">${lm_fmt(m.weight)}</td>
				<td class="text-right">${lm_fmt(r.qty, 0)}</td>
				<td class="text-right"><b>${lm_fmt(corr_qty, 0)}</b></td>
					<td class="text-right">${m.select_corrugated_box ? lm_stock_html(stock, m.select_corrugated_box, corr_qty) : "-"}</td>
				<td class="text-right">${lm_fmt(flt(m.weight) * r.qty, 2)}</td></tr>`);
		});
	});
	return `<div class="small" style="font-weight:600">Corrugated box (Logistic mapping)</div>` +
		lm_table(
			["Item", "Logistic", "Corrugated Box", "Box Name", "Box Size", "Weight / pc (kg)", "Item Qty", "Corrugated Box Qty", "Corrugated Box Stock", "Total Weight (kg)"],
			body
		);
}

function lm_packing_html(pieces, skipped, boxes, stock) {
	let html = "";

	if (skipped.length) {
		html += `<div class="text-warning small" style="margin-bottom:6px">Not included in the wooden box suggestion: ${skipped
			.map((x) => `<b>${lm_esc(x.item_code)}</b> (${lm_esc(x.reason)})`)
			.join(", ")}.</div>`;
	}
	if (!pieces.length) {
		return html + `<div class="text-muted small" style="margin-bottom:6px">No item has a usable corrugated box mapping, so no wooden box can be suggested.</div>`;
	}

	const no_wt = pieces.filter((p) => !p.unit_kg);
	if (no_wt.length) {
		html += `<div class="text-warning small" style="margin-bottom:6px">Weight is not set for ${no_wt
			.map((p) => "<b>" + lm_esc(p.item_code) + "</b>")
			.join(", ")} - its weight is not counted in the weight check.</div>`;
	}
	if (!boxes.length) {
		return html + `<div class="text-warning small" style="margin-bottom:6px">No Item found in Consumables &gt; Packing Material &gt; Wooden box.</div>`;
	}

	const total_qty = pieces.reduce((t, p) => t + p.qty, 0);
	const total_kg = pieces.reduce((t, p) => t + p.qty * p.unit_kg, 0);
	html += `<div class="small" style="font-weight:600">Suggested wooden box for all items together (${lm_fmt(total_qty, 0)} corrugated boxes, ${lm_fmt(total_kg, 2)} kg)</div>`;

	const { options, max_load } = lm_suggest(boxes, pieces);
	if (!options.length) {
		const reach = LM_CONFIG.allow_two_boxes ? "one wooden box, or two wooden boxes together," : "one wooden box";
		const largest = max_load ? ` The largest wooden box can carry ${lm_fmt(max_load, 2)} kg.` : "";
		return html + `<div class="text-danger small" style="margin-bottom:6px">No valid wooden box: ${reach} must hold all items (${lm_fmt(total_kg, 2)} kg) by size and weight.${largest} Create a wooden box Item with enough size and weight capacity (Consumables &gt; Packing Material &gt; Wooden box).</div>`;
	}

	const rows = [];
	options.forEach((o, i) => {
		const tag = `<span class="indicator-pill ${i === 0 ? "green" : "blue"}">${i === 0 ? "Best" : "Option " + (i + 1)}</span>` +
			`<br><span class="text-muted small">${o.count === 1 ? "1 box" : "2 boxes"}</span>`;
		o.parts.forEach((x, k) => {
			const need = o.parts.filter((y) => y.info.box.name === x.info.box.name).length * LM_CONFIG.boxes_per_piece;
			const contents = pieces
				.map((p, n) => (x.load[n] ? `${lm_esc(p.item_code)} &times; <b>${x.load[n]}</b>` : ""))
				.filter(Boolean)
				.join("<br>");
			rows.push(`<tr${i === 0 ? ' style="background:var(--green-50, #f0fff4)"' : ""}>
				${k === 0 ? `<td rowspan="${o.parts.length}">${tag}</td>` : ""}
				<td><a href="/app/item/${encodeURIComponent(x.info.box.name)}">${lm_esc(x.info.box.name)}</a><br>
					<span class="text-muted small">${lm_esc(x.info.box.item_name)}</span></td>
				<td>${x.info.box_dims.map((d) => lm_fmt(d, 1)).join(" x ")}</td>
				<td class="text-right">${x.info.max_kg ? lm_fmt(x.info.max_kg, 2) : "-"}</td>
					<td class="text-right">${lm_stock_html(stock, x.info.box.name, need)}</td>
				<td>${contents}</td>
				<td class="text-right">${lm_fmt(x.used * 100, 0)} %</td>
				<td class="text-right">${total_kg ? lm_fmt(x.kg, 2) : "-"}</td></tr>`);
		});
	});

	return html + lm_table(
		["", "Wooden Box", "Size W x L x H (mm)", "Max Load (kg)", "Wooden Box Stock", "Corrugated boxes packed", "Space used", "Load (kg)"],
		rows
	);
}

async function lm_render(frm) {
	const field = frm.fields_dict.custom_logistic_mapping;
	if (!field) return;

	const token = (frm.__lm_token = (frm.__lm_token || 0) + 1);
	try {
		const { rows, boxes, stock } = await lm_fetch(frm);
		if (token !== frm.__lm_token) return;

		if (!rows.length) {
			field.$wrapper.html(`<div class="text-muted small">Add items to see logistic mapping and wooden box suggestions.</div>`);
			return;
		}

		const open_state = {};
		field.$wrapper.find("details[data-lm-key]").each(function () {
			open_state[this.getAttribute("data-lm-key")] = this.open;
		});
		const main_open = open_state.main === true;

		const { pieces, skipped } = lm_build_pieces(rows);

		field.$wrapper.html(
			`<details class="lm-wrap" data-lm-key="main"${main_open ? " open" : ""}>
				<summary style="cursor:pointer;outline:none;padding:4px 0">
					<b>Logistic Mapping &amp; Packing Suggestion</b>
					<span class="text-muted">(${rows.length} ${rows.length === 1 ? "item" : "items"})</span>
				</summary>
				<div style="margin-top:8px">
					${lm_mapping_html(rows, stock)}
					${lm_packing_html(pieces, skipped, boxes, stock)}
				</div>
			</details>`
		);
	} catch (e) {
		console.error("custom_logistic_mapping", e);
		field.$wrapper.html(`<div class="text-danger small">Could not load logistic mapping. Check the console for details.</div>`);
	}
}

async function lm_get_plan(frm) {
	const { rows, boxes, stock } = await lm_fetch(frm);
	if (!rows.length) return { pieces: [], options: [], reason: __("Add items first.") };

	const { pieces, skipped } = lm_build_pieces(rows);
	if (!pieces.length) {
		return { pieces, options: [], reason: __("No item has a usable corrugated box mapping (Logistic record).") };
	}
	if (!boxes.length) {
		return { pieces, options: [], reason: __("No wooden box Item found in Consumables > Packing Material > Wooden box.") };
	}

	const { options } = lm_suggest(boxes, pieces);
	if (!options.length) {
		return { pieces, options: [], reason: __("No valid wooden box option for these items. See the Logistic Mapping section.") };
	}
	return { pieces, options, skipped, stock };
}

// what has to be added to Items for one option: corrugated boxes (summed per box code) + wooden boxes
function lm_plan_items(pieces, option) {
	const corr = {};
	pieces.forEach((p) => {
		const c = (corr[p.corr_code] = corr[p.corr_code] || { code: p.corr_code, name: p.corr_name, qty: 0 });
		c.qty += p.qty;
	});

	const wood = {};
	option.parts.forEach((x) => {
		const w = (wood[x.info.box.name] = wood[x.info.box.name] || {
			code: x.info.box.name,
			name: x.info.box.item_name,
			qty: 0,
		});
		w.qty += LM_CONFIG.boxes_per_piece;
	});

	return { corrugated: Object.values(corr), wooden: Object.values(wood) };
}

function lm_option_label(option, index) {
	const names = option.parts.map((x) => x.info.box.name).join(" + ");
	return `${index === 0 ? __("Best") : __("Option") + " " + (index + 1)} - ${names} (${option.count === 1 ? __("1 box") : __("2 boxes")})`;
}

function lm_option_summary_html(pieces, option, stock) {
	const plan = lm_plan_items(pieces, option);
	const line = (l) => `<tr><td>${lm_esc(l.code)}<br><span class="text-muted small">${lm_esc(l.name)}</span></td><td class="text-right"><b>${lm_fmt(l.qty, 0)}</b></td><td class="text-right">${lm_stock_html(stock, l.code, l.qty)}</td></tr>`;
	return `<table class="table table-bordered table-sm">
		<thead><tr><th>${__("Item to add")}</th><th class="text-right">${__("Qty")}</th><th class="text-right">${__("Stock")}</th></tr></thead>
		<tbody>
			<tr><td colspan="3" class="text-muted small">${__("Corrugated Box")}</td></tr>
			${plan.corrugated.map(line).join("")}
			<tr><td colspan="3" class="text-muted small">${__("Wooden Box")}</td></tr>
			${plan.wooden.map(line).join("")}
		</tbody></table>`;
}

async function lm_add_freight(frm) {
	if (frm.doc.docstatus !== 0) return;
	if (!frm.doc.company) {
		frappe.msgprint(__("Please select a Company first."));
		return;
	}

	let plan;
	try {
		frappe.dom.freeze(__("Calculating packing options..."));
		plan = await lm_get_plan(frm);
	} catch (e) {
		console.error("lm_add_freight", e);
		frappe.msgprint(__("Could not calculate packing options. Check the console for details."));
		return;
	} finally {
		frappe.dom.unfreeze();
	}

	if (!plan.options.length) {
		frappe.msgprint(plan.reason);
		return;
	}

	const { pieces, options, stock } = plan;

	const d = new frappe.ui.Dialog({
		title: __("Add Freight"),
		fields: [
			{
				fieldname: "option",
				fieldtype: "Select",
				label: __("Packing Option"),
				options: options.map((o, i) => ({ label: lm_option_label(o, i), value: String(i) })),
				default: "0",
				reqd: 1,
				change: function () {
					const o = options[cint(d.get_value("option"))];
					if (o) d.fields_dict.summary.$wrapper.html(lm_option_summary_html(pieces, o, stock));
				},
			},
			{ fieldname: "summary", fieldtype: "HTML" },
			{
				fieldname: "freight",
				fieldtype: "Currency",
				label: __(LM_CONFIG.freight_account_name),
				options: frm.doc.currency,
				reqd: 1,
			},
		],
		primary_action_label: __("Add"),
		primary_action: async function (values) {
			const freight = flt(values.freight);
			if (freight <= 0) {
				frappe.msgprint(__("Freight amount must be greater than zero."));
				return;
			}
			d.hide();
			await lm_apply_freight(frm, pieces, options[cint(values.option)], freight);
		},
	});

	d.show();
	d.fields_dict.summary.$wrapper.html(lm_option_summary_html(pieces, options[0], stock));
}

async function lm_apply_freight(frm, pieces, option, freight) {
	frappe.dom.freeze(__("Adding freight..."));
	try {
		// check the account first so nothing is added when it is missing
		const acc = await frappe.db.get_value(
			"Account",
			{ company: frm.doc.company, account_name: LM_CONFIG.freight_account_name, is_group: 0 },
			"name"
		);
		const account_head = acc && acc.message ? acc.message.name : null;
		if (!account_head) {
			frappe.msgprint(
				__("Account <b>{0}</b> not found for company <b>{1}</b>.", [LM_CONFIG.freight_account_name, frm.doc.company])
			);
			return;
		}

		const wanted = lm_plan_items(pieces, option);

		// a previous "Add Freight" may have added wooden boxes of another option - remove those first
		await lm_remove_stale_wooden_boxes(frm, new Set(wanted.wooden.map((w) => w.code)));

		for (const l of [...wanted.corrugated, ...wanted.wooden]) {
			await lm_set_item_row(frm, l.code, l.qty);
		}

		await lm_set_freight_tax(frm, account_head, freight);

		frm.refresh_field("items");
		frm.refresh_field("taxes");
		if (frm.cscript && frm.cscript.calculate_taxes_and_totals) {
			frm.cscript.calculate_taxes_and_totals();
		}
		frappe.show_alert({ message: __("Boxes and freight added"), indicator: "green" });
	} catch (e) {
		console.error("lm_apply_freight", e);
		frappe.msgprint(__("Could not add freight completely. Please check Items and Taxes."));
	} finally {
		frappe.dom.unfreeze();
	}
}

// remove wooden box rows (Consumables > Packing Material > Wooden box) that are not part of the chosen option
async function lm_remove_stale_wooden_boxes(frm, keep_codes) {
	const codes = [...new Set((frm.doc.items || []).map((d) => d.item_code).filter(Boolean))];
	if (!codes.length) return;

	const filters = Object.assign({}, LM_CONFIG.box_filters, { name: ["in", codes] });
	delete filters.disabled; // a box that was added earlier may have been disabled since
	const wooden = new Set((await lm_get_list("Item", filters, ["name"])).map((i) => i.name));

	const stale = (frm.doc.items || []).filter((d) => wooden.has(d.item_code) && !keep_codes.has(d.item_code));
	// clear_doc takes the row out of frm.doc.items and re-numbers idx
	stale.forEach((d) => frappe.model.clear_doc(d.doctype, d.name));
}

// update the qty when the item is already in the table, otherwise add a new row
async function lm_set_item_row(frm, item_code, qty) {
	let row = (frm.doc.items || []).find((d) => d.item_code === item_code);
	if (!row) {
		row = frm.add_child("items");
		await frappe.model.set_value(row.doctype, row.name, "item_code", item_code);
	}
	await frappe.model.set_value(row.doctype, row.name, "qty", flt(qty));
}

async function lm_set_freight_tax(frm, account_head, amount) {
	let row = (frm.doc.taxes || []).find((t) => t.account_head === account_head);
	if (!row) {
		row = frm.add_child("taxes");
		await frappe.model.set_value(row.doctype, row.name, "charge_type", "Actual");
		await frappe.model.set_value(row.doctype, row.name, "account_head", account_head);
	}
	await frappe.model.set_value(row.doctype, row.name, "description", LM_CONFIG.freight_account_name);
	await frappe.model.set_value(row.doctype, row.name, "tax_amount", flt(amount));
}


function open_item_wise_sales_history(frm) {
    const item_codes = [
        ...new Set((frm.doc.items || []).map((r) => r.item_code).filter(Boolean)),
    ];

    if (!item_codes.length) {
        frappe.msgprint(__("No items found in this Quotation."));
        return;
    }

    const d = new frappe.ui.Dialog({
        title: __("Item-wise Sales History"),
        fields: [
            {
                fieldname: "item_code",
                fieldtype: "Link",
                options: "Item",
                label: __("Item"),
                default: item_codes[0],
                reqd: 1,
                get_query: function () {
                    return {
                        filters: { name: ["in", item_codes] },
                    };
                },
            },
        ],
        primary_action_label: __("View History"),
        primary_action: function (values) {
            d.hide();

            const today = frappe.datetime.get_today();

            frappe.route_options = {
                company: frm.doc.company,
                item_code: values.item_code,
                from_date: frappe.datetime.add_months(today, -12),
                to_date: today,
            };

            frappe.set_route("query-report", "Item-wise Sales History");
        },
    });

    d.show();
}

function open_customer_wise_sales_history(frm) {
    if (frm.doc.quotation_to !== "Customer" || !frm.doc.party_name) {
        frappe.msgprint(__("This quotation is not against a Customer."));
        return;
    }

    const today = frappe.datetime.get_today();

    frappe.route_options = {
        company: frm.doc.company,
        customer: frm.doc.party_name,
        from_date: frappe.datetime.add_months(today, -12),
        to_date: today,
    };

    frappe.set_route("query-report", "Item-wise Sales History");
}



frappe.ui.form.on("Supplier CT", {
    
    custom_select_freight_and_forwarder_remove(frm) {
        clear_forwarder_if_not_selected(frm);
    },
     freight_and_forwarder(frm) {
        clear_forwarder_if_not_selected(frm);
        set_forwarder_emails(frm);
    }
});

const TRANSPORTER_GROUP = "Transporter";

function load_transporter_suppliers(frm) {
    if (frm.transporter_suppliers_loaded) return;
    frm.transporter_suppliers_loaded = true;

    const main_group = frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Supplier",
            filters: { supplier_group: TRANSPORTER_GROUP, disabled: 0 },
            fields: ["name"],
            limit_page_length: 0
        }
    });

    const other_groups = frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Supplier Group CT",
            parent: "Supplier",
            filters: {
                supplier_group: TRANSPORTER_GROUP,
                parenttype: "Supplier",
                parentfield: "custom_other_supplier_group_included"
            },
            fields: ["parent"],
            limit_page_length: 0
        }
    });

    Promise.all([main_group, other_groups])
        .then(([r1, r2]) => {
            const names = new Set();
            (r1.message || []).forEach((d) => names.add(d.name));
            (r2.message || []).forEach((d) => names.add(d.parent));
            frm.transporter_suppliers = Array.from(names);
        })
        .catch(() => {
            // Allow a retry on the next refresh if loading failed
            frm.transporter_suppliers_loaded = false;
        });
}

function get_selected_forwarders(frm) {
    return (frm.doc.custom_select_freight_and_forwarder || [])
        .map((row) => row.freight_and_forwarder)
        .filter(Boolean);
}

function clear_forwarder_if_not_selected(frm) {
    const current = frm.doc.custom_freight_and_forwarder;
    if (current && !get_selected_forwarders(frm).includes(current)) {
        frm.set_value("custom_freight_and_forwarder", "");
    }
}

async function set_forwarder_emails(frm) {
    if (frm.doc.docstatus !== 0) return;

    // token so a slow earlier call can't overwrite a newer result
    const token = (frm.__ff_email_token = (frm.__ff_email_token || 0) + 1);
    const suppliers = [...new Set(get_selected_forwarders(frm))];
    let emails = "";

    if (suppliers.length) {
        const r = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Supplier",
                filters: { name: ["in", suppliers] },
                fields: ["name", "email_id"],
                limit_page_length: 0
            }
        });
        if (token !== frm.__ff_email_token) return;

        const email_by_supplier = {};
        (r.message || []).forEach((d) => {
            email_by_supplier[d.name] = d.email_id;
        });

        // keep the selection order, drop blanks, split any multi-email values, remove duplicates
        const list = suppliers
            .map((s) => email_by_supplier[s])
            .filter(Boolean)
            .flatMap((e) => e.split(","))
            .map((e) => e.trim())
            .filter(Boolean);

        emails = [...new Set(list)].join(", ");
    }

    if ((frm.doc.custom_freight_and_forwarder_email || "") !== emails) {
        frm.set_value("custom_freight_and_forwarder_email", emails);
    }
}




function render_mode_of_transport_checkboxes(frm) {
    const field = frm.fields_dict[MODE_OF_TRANSPORT_FIELD];
    if (!field) return;

    field.$wrapper.find(".control-input").hide();
    field.$wrapper.find(".mode-multiselect").remove();

    const selected = (frm.doc[MODE_OF_TRANSPORT_FIELD] || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

    const read_only = frm.doc.docstatus === 2 || field.df.read_only;

    const $container = $('<div class="mode-multiselect" style="display:flex; gap:16px; flex-wrap:wrap; padding:4px 0;"></div>');

    MODE_OF_TRANSPORT_OPTIONS.forEach((option) => {
        const checked = selected.includes(option) ? "checked" : "";
        const disabled = read_only ? "disabled" : "";
        const $item = $(`
            <label style="display:flex; align-items:center; gap:6px; margin:0; font-weight:normal; cursor:pointer;">
                <input type="checkbox" class="mode-opt" value="${option}" ${checked} ${disabled}>
                <span>${option}</span>
            </label>
        `);
        $container.append($item);
    });

    $container.on("change", ".mode-opt", function () {
        const values = [];
        $container.find(".mode-opt:checked").each(function () {
            values.push($(this).val());
        });
        const new_value = values.join(", ");
        if ((frm.doc[MODE_OF_TRANSPORT_FIELD] || "") !== new_value) {
            // set silently to avoid re-render loop, then mark dirty
            frm.doc[MODE_OF_TRANSPORT_FIELD] = new_value;
            frm.dirty();
            frm.refresh_field(MODE_OF_TRANSPORT_FIELD);
            field.$wrapper.find(".control-input").hide();
        }
    });

    field.$wrapper.append($container);
}

function add_item_wise_quotation_buttons(frm) {
    const REPORT_NAME = "Item Wise Quotation Report";

    // Unique, non-empty item codes from the quotation's items table
    function get_item_codes() {
        const codes = (frm.doc.items || [])
            .map((row) => row.item_code)
            .filter((code) => !!code);
        return Array.from(new Set(codes));
    }

    function open_report(with_customer) {
        const item_codes = get_item_codes();
        if (!item_codes.length) {
            frappe.msgprint(__("Please add at least one item first."));
            return;
        }

        const route_options = { item_code: item_codes };

        if (with_customer) {
            if (frm.doc.quotation_to !== "Customer" || !frm.doc.party_name) {
                frappe.msgprint(__("Please select a customer first."));
                return;
            }
            route_options.customer = frm.doc.party_name;
        }

        frappe.route_options = route_options;
        frappe.set_route("query-report", REPORT_NAME);
    }

    frm.add_custom_button(
        __("Item Wise - All Customers"),
        () => open_report(false),
        __("View")
    );

    frm.add_custom_button(
        __("Item Wise - This Customer"),
        () => open_report(true),
        __("View")
    );
}