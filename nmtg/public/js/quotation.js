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
        // Email composer in the Activities tab pre-fills from this field
        frm.email_field = "contact_email";

        frm.set_query("quotation_to", function () {
            return {
                filters: {
                    name: ["in", ["Customer", "Lead", "Enquiry"]],
                },
            };
        });
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

    refresh: function (frm) {
        setup_dealer_liason_type(frm);
        recalculate_all_commissions(frm);
        setup_dealer_liason_query(frm);
        set_valid_till(frm);

        // Notes / Activities tabs (must run before the early returns below)
        render_crm_notes(frm);
        render_crm_activities(frm);

        // Fill dealer name / dealer email if either is missing (draft only)
        if (
            frm.doc.docstatus === 0 &&
            frm.doc.quotation_to === "Customer" &&
            frm.doc.party_name &&
            (!frm.doc.custom_dealer_name || !frm.doc.custom_dealer_email)
        ) {
            set_dealer_from_customer(frm);
        }

        // New quotation with customer already filled (copy / mapping / default):
        // party_name event never fires, so fetch the terms here.
        if (frm.is_new() && frm.doc.quotation_to === "Customer" && frm.doc.party_name && !frm.doc.tc_name) {
            set_terms_from_customer(frm);
        }

        // Email dealer button (shown whenever a dealer is set on a saved quotation)
        if (!frm.is_new() && frm.doc.custom_dealer_name) {
            frm.add_custom_button(__("Email Dealer"), () => email_dealer(frm));
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

        frm.add_custom_button(
            __("Stock Balance"),
            () => open_stock_balance_for_items(frm),
            __("View")
        );

        // Automatic message: stock available + other quotations without Delivery Note
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

    before_workflow_action: function (frm) {
        if (frm.selected_workflow_action !== 'Reject') {
            return;
        }

        frappe.dom.unfreeze();

        return new Promise((resolve, reject) => {
            let submitted = false;

            const d = new frappe.ui.Dialog({
                title: __('Reason for Rejection'),
                fields: [
                    {
                        fieldname: 'custom_rejection_remark',
                        fieldtype: 'Small Text',
                        label: __('Rejection Remark'),
                        reqd: 1
                    }
                ],
                primary_action_label: __('Submit Rejection'),
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
                            // Saving the remark failed: keep the workflow action blocked
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

// ---------------------------------------------------------------------------
// Notes / Activities tabs (same widgets Lead uses)
// ---------------------------------------------------------------------------

// The ERPNext widgets read frm.doc.notes; our child table is custom_note.
// Non-enumerable getter so it is never serialized when the doc is saved.
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

            // Qty of each item needed in this quotation
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

            // No dealer on the customer: clear the email and stop
            if (!dealer) {
                if (frm.doc.custom_dealer_email) {
                    frm.set_value("custom_dealer_email", null);
                }
                return;
            }

            // The dealer is itself a Customer, so read its email_id
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