frappe.ui.form.on("Sales Order", {
    setup: function (frm) {
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

    custom_add_freight: function (frm) {
        lm_add_freight(frm);
    },

    party_name: function (frm) {
        set_dealer_from_customer(frm);
    },

    after_save: function (frm) {
        setup_dealer_liason_type(frm);
        sync_terms_to_master(frm);
    },

    onload_post_render: function (frm) {
        setup_dealer_liason_type(frm);
        lm_render(frm);
    },

    custom_dealer__liason_add: function (frm) {
        setup_dealer_liason_type(frm);
    },

    custom_dealer__liason_on_form_rendered: function (frm) {
        setup_dealer_liason_type(frm);
    },

    refresh: function (frm) {
        set_forwarder_emails(frm);
        load_transporter_suppliers(frm);
        lm_render(frm);
        setup_dealer_liason_type(frm);
        show_pending_sales_order_message(frm);
        recalculate_all_commissions(frm);
        setup_dealer_liason_query(frm);


        if (frm.doc.docstatus !== 1) return;
        if (["Closed", "Cancelled", "Completed"].includes(frm.doc.status)) return;

        // Only items that are not fully delivered can be held / unheld
        const items = (frm.doc.items || []).filter(is_pending_delivery);
        const held = items.filter((r) => r.custom_status === "On Hold");
        const active = items.filter((r) => r.custom_status !== "On Hold");

        if (active.length) {
            frm.add_custom_button(
                __("Hold Items"),
                () => show_item_hold_dialog(frm, "hold"),
                __("Item Hold")
            );
        }
        if (held.length) {
            frm.add_custom_button(
                __("Unhold Items"),
                () => show_item_hold_dialog(frm, "unhold"),
                __("Item Hold")
            );
        }

        if (frm.doc.quotation_to === "Customer" && frm.doc.customer) {
            set_dealer_from_customer(frm);
        }

        if (
            frm.is_new() &&
            frm.doc.docstatus === 0 &&
            frm.doc.customer &&
            frm.doc.customer_address &&
            frm.__nmtg_sales_team_checked_for !== frm.doc.name
        ) {
            frm.__nmtg_sales_team_checked_for = frm.doc.name;
            nmtg_schedule_sales_team_sync(frm);
        }

        if (frm.is_new()) return;

        let has_pending = (frm.doc.items || []).some(
            it => it.drawing_approval_required === "Yes" && !it.drawing_email_sent
        );

        if (has_pending) {
            frm.add_custom_button("Send Drawing Verification Emails", function () {
                frappe.confirm(
                    "Send drawing verification emails for all pending items in this document?",
                    () => {
                        frappe.call({
                            method: "nmtg.override.api.send_drawing_verification_emails_for_doc",
                            args: { docname: frm.doc.name },
                            freeze: true,
                            freeze_message: "Sending emails...",
                            callback: function (r) {
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
        if (frm.doc.docstatus !== 1) {
            return;
        }

        frm.remove_custom_button("Payment Request", "Create");

        frm.add_custom_button(
            __("Payment Request"),
            function () {
                show_so_payment_term_dialog(frm);
            },
            __("Create")
        );
    },

    customer(frm) {
        if (frm.doc.docstatus === 0) {
            frm.clear_table("sales_team");
            frm.refresh_field("sales_team");
        }
        nmtg_schedule_sales_team_sync(frm);
    },

    customer_address(frm) {
        nmtg_schedule_sales_team_sync(frm);
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

    // Merged: Reject + On Hold + Unhold SO remark dialogs
    before_workflow_action: function (frm) {
        const action = frm.selected_workflow_action;

        if (action === "Reject") {
            frappe.dom.unfreeze();

            return new Promise((resolve, reject) => {
                let submitted = false;

                const d = new frappe.ui.Dialog({
                    title: __("Reason for Rejection"),
                    fields: [
                        {
                            fieldname: "custom_rejection_remark",
                            fieldtype: "Small Text",
                            label: __("Rejection Remark"),
                            reqd: 1
                        }
                    ],
                    primary_action_label: __("Submit Rejection"),
                    primary_action: function (values) {
                        submitted = true;
                        d.disable_primary_action();

                        frappe.call({
                            method: "nmtg.override.api.custom_set_rejection_remark",
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

                d.$wrapper.on("hidden.bs.modal", () => {
                    if (!submitted) {
                        frappe.show_alert({
                            message: __("Rejection cancelled — remark is required"),
                            indicator: "orange"
                        });
                        reject();
                    }
                });

                d.show();
            });
        }

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
    }
});


function show_pending_sales_order_message(frm) {
    const item_codes = [
        ...new Set((frm.doc.items || []).map((r) => r.item_code).filter(Boolean)),
    ];

    if (!item_codes.length) return;

    frappe.call({
        method: "nmtg.override.sales_order.sales_order_stock_allocation",
        args: {
            item_codes: item_codes.join(","),
            company: frm.doc.company,
            sales_order: frm.doc.name,
        },
        callback(r) {
            if (frm.dashboard.clear_comment) frm.dashboard.clear_comment();

            const data = (r.message || []).filter((d) => d.orders && d.orders.length);
            if (!data.length) return;

            const esc = frappe.utils.escape_html;

            // Qty of each item needed in this Sales Order
            const this_qty = {};
            (frm.doc.items || []).forEach((row) => {
                this_qty[row.item_code] =
                    (this_qty[row.item_code] || 0) + flt(row.stock_qty || row.qty);
            });

            const summary_style = "cursor:pointer;outline:none;padding:2px 0";

            let html = `
                <details>
                    <summary style="${summary_style}">
                        <b>${__("Other Sales Orders without Delivery Note")}</b>
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
                            ${__("Pending in other Sales Orders")}: <b>${d.pending_total}</b> |
                            ${__("This Sales Order")}: <b>${need}</b> |
                            <span style="color:${color}"><b>${__("Balance")}: ${d.available}</b></span>
                        </summary>
                        <table class="table table-bordered" style="margin:6px 0 0 0;background:#fff">
                            <thead>
                                <tr>
                                    <th>${__("Sales Order")}</th>
                                    <th>${__("Customer")}</th>
                                    <th>${__("Date")}</th>
                                    <th>${__("Delivery Date")}</th>
                                    <th>${__("Status")}</th>
                                    <th style="text-align:right">${__("Qty")}</th>
                                    <th style="text-align:right">${__("Pending Delivery")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${d.orders
                                    .map(
                                        (o) => `
                                    <tr>
                                        <td><a href="/app/sales-order/${encodeURIComponent(o.sales_order)}">${esc(o.sales_order)}</a></td>
                                        <td>${esc(o.customer || "")}</td>
                                        <td>${frappe.datetime.str_to_user(o.date)}</td>
                                        <td>${o.delivery_date ? frappe.datetime.str_to_user(o.delivery_date) : ""}</td>
                                        <td>${esc(o.status || "")}${o.docstatus === 0 ? " (" + __("Draft") + ")" : ""}</td>
                                        <td style="text-align:right">${o.qty}</td>
                                        <td style="text-align:right">${o.pending_qty}</td>
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
    // Logistic mapping / packing suggestion re-render
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

    drawing_approval_required(frm, cdt, cdn) {
        render_attachment_slots(frm, cdt, cdn);
    },
    form_render(frm, cdt, cdn) {
        render_attachment_slots(frm, cdt, cdn);

        let row = locals[cdt][cdn];
        if (row.item_code && !row.__special_char_fetched) {
            fetch_and_render_special_characteristics(frm, cdt, cdn);
        } else {
            render_special_characteristics_html(frm, cdt, cdn, row.__special_char_cache || []);
        }
    },
    attachment_qty(frm, cdt, cdn) {
        sync_attachment_rows(frm, cdt, cdn);
        render_attachment_slots(frm, cdt, cdn);
    },
    item_code: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        row.__special_char_fetched = false;
        fetch_and_render_special_characteristics(frm, cdt, cdn);
        lm_render_debounced(frm);
    },
    custom_assign_to_responsible_users: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (frm.is_new()) {
            frappe.msgprint(__("Please save the document first."));
            return;
        }

        if (!row.custom_special_item_role) {
            frappe.msgprint(__("No responsible role found for this item's special characteristics."));
            return;
        }

        let roles = row.custom_special_item_role
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);

        frappe.call({
            method: "nmtg.override.api.get_users_by_roles",
            args: { roles: roles },
            freeze: true,
            freeze_message: __("Finding responsible users..."),
            callback: function (r) {
                let users = r.message || [];

                if (!users.length) {
                    frappe.msgprint(__("No enabled users found with role(s): {0}", [roles.join(", ")]));
                    return;
                }

                frappe.call({
                    method: "frappe.desk.form.assign_to.add",
                    args: {
                        assign_to: JSON.stringify(users),
                        doctype: frm.doctype,
                        name: frm.doc.name,
                        description: __("Special item on row {0} ({1}) needs attention — role(s): {2}", [
                            row.idx,
                            row.item_code,
                            roles.join(", "),
                        ]),
                    },
                    callback: function () {
                        frappe.show_alert({
                            message: __("Assigned to: {0}", [users.join(", ")]),
                            indicator: "green",
                        });
                        frm.reload_doc();
                    },
                });
            },
        });
    },
});

frappe.ui.form.on("Dealer Liason CT", {
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
        precision("commission_amount", row)
    );

    calculate_third_party_commission_amount(frm, cdt, cdn);

    frm.refresh_field("custom_dealer__liason");
}

function calculate_third_party_commission_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    row.third_party_commission_amount = flt(
        flt(row.commission_amount) * flt(row.third_party_commission_) / 100,
        precision("third_party_commission_amount", row)
    );

    frm.refresh_field("custom_dealer__liason");
}

function recalculate_all_commissions(frm) {
    (frm.doc.custom_dealer__liason || []).forEach(function (row) {
        let total = flt(frm.doc.total);

        row.commission_amount = flt(
            total * flt(row.commission_) / 100,
            precision("commission_amount", row)
        );

        row.third_party_commission_amount = flt(
            flt(row.commission_amount) * flt(row.third_party_commission_) / 100,
            precision("third_party_commission_amount", row)
        );
    });
    frm.refresh_field("custom_dealer__liason");
}


function sync_attachment_rows(frm, cdt, cdn) {
    let linked = (frm.doc.attachment || []).filter(a => a.item_row === cdn);
    let qty = cint(locals[cdt][cdn].attachment_qty);

    if (linked.length > qty) {
        let to_remove = linked.slice(qty).filter(a => !a.attachment);
        to_remove.forEach(a => frm.get_field("attachment").grid.grid_rows_by_docname[a.name].remove());
    }
    frm.refresh_field("attachment");
}


function get_html_wrapper(frm, cdt, cdn, fieldname) {
    let grid_row = frm.fields_dict["items"].grid.grid_rows_by_docname[cdn];
    if (!grid_row) return null;

    if (!grid_row.grid_form || !grid_row.grid_form.fields_dict) return null;

    let field = grid_row.grid_form.fields_dict[fieldname];
    if (!field || !field.$wrapper) return null;

    return field.$wrapper;
}


function render_attachment_slots(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let $wrapper = get_html_wrapper(frm, cdt, cdn, "attachment");
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


function fetch_and_render_special_characteristics(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    row.__special_char_fetched = true;

    if (!row.item_code) {
        frappe.model.set_value(cdt, cdn, "custom_special_item_role", "");
        row.__special_char_cache = [];
        render_special_characteristics_html(frm, cdt, cdn, []);
        return;
    }

    frappe.db.get_doc("Item", row.item_code).then((item_doc) => {
        let characteristics = item_doc.custom_special_characteristics || [];

        let roles = [...new Set(
            characteristics.map((d) => d.responsible_role).filter(Boolean)
        )].join(", ");
        frappe.model.set_value(cdt, cdn, "custom_special_item_role", roles);

        row.__special_char_cache = characteristics;
        render_special_characteristics_html(frm, cdt, cdn, characteristics);
    });
}

function render_special_characteristics_html(frm, cdt, cdn, characteristics) {
    let $wrapper = get_html_wrapper(frm, cdt, cdn, "custom_special_item_html");
    if (!$wrapper) return;

    $wrapper.empty();

    if (!characteristics || !characteristics.length) {
        $wrapper.append(`<div class="text-muted" style="font-size:12px;">No special characteristics for this item.</div>`);
        return;
    }

    let rows = characteristics
        .map(
            (d) => `
            <tr>
                <td>${frappe.utils.escape_html(d.special_characteristics || "")}</td>
                <td>${frappe.utils.escape_html(d.description || "")}</td>
                <td>${frappe.utils.escape_html(d.responsible_role || "")}</td>
            </tr>`
        )
        .join("");

    $wrapper.append(`
        <table class="table table-bordered" style="margin-bottom:0;">
            <thead>
                <tr>
                    <th>Special Characteristics</th>
                    <th>Description</th>
                    <th>Responsible Role</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `);
}


function nmtg_schedule_sales_team_sync(frm) {
    clearTimeout(frm.__nmtg_sales_team_timer);
    frm.__nmtg_sales_team_timer = setTimeout(() => {
        frappe.after_ajax(() => {
            setTimeout(() => nmtg_fetch_sales_team_by_address(frm), 300);
        });
    }, 500);
}

function nmtg_fetch_sales_team_by_address(frm) {
    if (frm.doc.docstatus !== 0) return;

    if (!frm.doc.customer || !frm.doc.customer_address) {
        frm.clear_table("sales_team");
        frm.refresh_field("sales_team");
        return;
    }

    const customer = frm.doc.customer;
    const customer_address = frm.doc.customer_address;

    frappe.call({
        method: "nmtg.override.customer.get_customer_sales_team",
        args: {
            customer: customer,
            customer_address: customer_address,
        },
        callback(r) {
            if (frm.doc.customer !== customer || frm.doc.customer_address !== customer_address) {
                return;
            }

            frm.clear_table("sales_team");

            (r.message || [])
                .filter((src) => src.custom_address === customer_address)
                .forEach((src) => {
                    const row = frm.add_child("sales_team");
                    row.sales_person = src.sales_person;
                    row.custom_address = src.custom_address;
                    row.allocated_percentage = src.allocated_percentage;
                });

            frm.refresh_field("sales_team");

            if (frm.cscript && frm.cscript.calculate_taxes_and_totals) {
                frm.cscript.calculate_taxes_and_totals();
            }
        },
    });
}


function show_so_payment_term_dialog(frm) {

    const payment_schedule = frm.doc.payment_schedule || [];

    // Only terms available in this Sales Order
    const payment_terms = payment_schedule
        .filter(row => row.payment_term)
        .map(row => row.payment_term);

    if (!payment_terms.length) {
        frappe.msgprint({
            title: __("No Payment Terms"),
            message: __("No payment terms are available in this Sales Order."),
            indicator: "orange"
        });

        return;
    }

    const dialog = new frappe.ui.Dialog({
        title: __("Create Payment Request"),

        fields: [
            {
                fieldname: "payment_term",
                fieldtype: "Select",
                label: __("Payment Term"),
                options: payment_terms.join("\n"),
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
                method: "nmtg.override.payment_request.create_so_payment_request",

                args: {
                    so: frm.doc.name,
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


function show_item_hold_dialog(frm, action) {
    const is_hold = action === "hold";

    // Only undelivered / partially delivered items
    const rows = (frm.doc.items || []).filter((r) => {
        if (!is_pending_delivery(r)) return false;
        return is_hold ? r.custom_status !== "On Hold" : r.custom_status === "On Hold";
    });

    if (!rows.length) {
        frappe.msgprint(__("No items available. Fully delivered items cannot be put on hold or released."));
        return;
    }

    const d = new frappe.ui.Dialog({
        title: is_hold ? __("Hold Items") : __("Unhold Items"),
        size: "extra-large",
        fields: [
            {
                fieldname: "items",
                fieldtype: "Table",
                label: __("Items"),
                cannot_add_rows: true,
                cannot_delete_rows: true,
                in_place_edit: true,
                data: rows.map((r) => ({
                    row_name: r.name,
                    idx_no: r.idx,
                    item_code: r.item_code,
                    item_name: r.item_name,
                    qty: r.qty,
                    delivered_qty: flt(r.delivered_qty),
                    current_hold_remark: r.custom_hold_remark || "",
                    remark: "",
                })),
                fields: [
                    { fieldname: "row_name", fieldtype: "Data", hidden: 1 },
                    { fieldname: "idx_no", fieldtype: "Int", label: __("#"), in_list_view: 1, read_only: 1, columns: 1 },
                    { fieldname: "item_code", fieldtype: "Data", label: __("Item Code"), in_list_view: 1, read_only: 1, columns: 2 },
                    { fieldname: "item_name", fieldtype: "Data", label: __("Item Name"), in_list_view: 1, read_only: 1, columns: 2 },
                    { fieldname: "qty", fieldtype: "Float", label: __("Qty"), in_list_view: 1, read_only: 1, columns: 1 },
                    { fieldname: "delivered_qty", fieldtype: "Float", label: __("Delivered"), in_list_view: 1, read_only: 1, columns: 1 },
                    ...(is_hold
                        ? []
                        : [{ fieldname: "current_hold_remark", fieldtype: "Data", label: __("Current Hold Remark"), in_list_view: 1, read_only: 1, columns: 2 }]),
                    {
                        fieldname: "remark",
                        fieldtype: "Data",
                        label: is_hold ? __("Hold Remark") : __("Unhold Remark"),
                        in_list_view: 1,
                        columns: 3,
                    },
                ],
            },
        ],
        primary_action_label: is_hold ? __("Hold") : __("Unhold"),
        primary_action() {
            // Use the grid's built-in row checkboxes
            const selected = d.fields_dict.items.grid.get_selected_children() || [];

            if (!selected.length) {
                frappe.msgprint(__("Please select at least one item."));
                return;
            }

            const missing = selected.filter((r) => !(r.remark || "").trim());
            if (missing.length) {
                frappe.msgprint({
                    title: __("Remark Required"),
                    message: __("Please enter a remark for item row(s): {0}", [
                        missing.map((r) => r.idx_no).join(", "),
                    ]),
                    indicator: "orange",
                });
                return;
            }

            frappe.call({
                method: "nmtg.override.sales_order.update_item_hold_status",
                args: {
                    sales_order: frm.doc.name,
                    items: selected.map((r) => ({
                        row_name: r.row_name,
                        remark: r.remark.trim(),
                    })),
                    action: action,
                },
                freeze: true,
                callback(r) {
                    if (!r.exc) {
                        d.hide();
                        frappe.show_alert({
                            message: is_hold
                                ? __("{0} item(s) put on hold", [r.message.updated])
                                : __("{0} item(s) released from hold", [r.message.updated]),
                            indicator: "green",
                        });
                        frm.reload_doc();
                    }
                },
            });
        },
    });

    d.show();
}

function is_pending_delivery(row) {
    return flt(row.delivered_qty) < flt(row.qty);
}


// =============================================================================
// Logistic mapping, packing suggestion & Add Freight  (same as Quotation)
// =============================================================================

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

// ---------------------------------------------------------------- packing
//
// All items of the quotation are packed TOGETHER: either in ONE wooden box, or in TWO wooden boxes
// (same or different). Every piece type (item -> its corrugated box) must satisfy BOTH:
//   size   : space used = sum(qty / how many of that corrugated box fit alone in the wooden box) <= 1
//            (estimate - each item takes its share of the box, all 6 orientations tried per item)
//   weight : sum(qty x corrugated box weight) <= wooden box max load (Item.weight_per_unit)

// pieces = [{ item_code, item_name, dims:[w,l,h] mm, qty, unit_kg }]
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

// ---------------------------------------------------------------- add freight
//
// Button custom_add_freight:
//   1. user picks one of the packing options shown in custom_logistic_mapping (Best / Option 2 ...)
//   2. user enters the freight amount
//   3. the needed corrugated boxes + the wooden box(es) of that option are added to Items,
//      and the amount is added to Taxes as "Freight and Forwarding Charges" (Actual)

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


// =============================================================================
// Freight and Forwarder selection (same as Quotation)
// =============================================================================

frappe.ui.form.on("Supplier CT", {
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