(function () {
    const FIELD = "custom_payment_terms"; // HTML field that shows the table
    const TERM_FIELD = "custom_payment_term"; // Link field to Payment Term
    const PRINT_FORMAT = "Proforma Invoice With Payment Term"; // Sales Order print format, name must match exactly

    frappe.ui.form.on("Payment Request", {
        setup(frm) {
            frm.set_query(TERM_FIELD, function () {
                const terms = frm.__pr_order_terms;
                if (!terms) {
                    return {};
                }
                return { filters: { name: ["in", terms.length ? terms : ["__none__"]] } };
            });
        },
        async refresh(frm) {
            await pr_load_order_terms(frm, false);
            pr_terms_v6_render(frm);
            render_item_payment(frm);
            pr_add_payment_entry_button(frm);
        },
        async reference_name(frm) {
            // reference changed by the user -> regenerate subject / message / print format
            await pr_load_order_terms(frm, true);
            pr_terms_v6_render(frm);
            render_item_payment(frm);
        },
        async reference_doctype(frm) {
            await pr_load_order_terms(frm, true);
            pr_terms_v6_render(frm);
        },
        custom_payment_term(frm) {
            pr_terms_v6_render(frm);
            render_item_payment(frm);
        },
        after_save(frm) {
            pr_terms_v6_render(frm);
        },
        custom_items_add(frm) {
            render_item_payment(frm);
        },
        custom_items_remove(frm) {
            render_item_payment(frm);
        },
    });

    function pr_add_payment_entry_button(frm) {
        if (
            frm.doc.docstatus !== 1 ||
            frm.doc.status !== "Requested" ||
            frm.doc.payment_request_type !== "Inward"
        ) {
            return;
        }

        frm.add_custom_button(
            __("Payment Entry"),
            function () {
                frappe.call({
                    method: "erpnext.accounts.doctype.payment_request.payment_request.make_payment_entry",
                    args: { docname: frm.doc.name },
                    freeze: true,
                    callback: function (r) {
                        if (!r.message) {
                            return;
                        }
                        frappe.model.sync(r.message);
                        frappe.set_route("Form", r.message.doctype, r.message.name);
                    }
                });
            },
            __("Create")
        );
    }

    // Which order / invoice doctypes belong together for a reference doctype
    function pr_get_config(dt) {
        if (dt === "Purchase Order" || dt === "Purchase Invoice") {
            return {
                order_dt: "Purchase Order",
                invoice_dt: "Purchase Invoice",
                invoice_item_dt: "Purchase Invoice Item",
                order_link_field: "purchase_order",
                order_label: "PO",
            };
        }
        if (dt === "Sales Order" || dt === "Sales Invoice") {
            return {
                order_dt: "Sales Order",
                invoice_dt: "Sales Invoice",
                invoice_item_dt: "Sales Invoice Item",
                order_link_field: "sales_order",
                order_label: "SO",
            };
        }
        return null;
    }

    // Resolve the order for the reference:
    // Purchase/Sales Order -> itself; Purchase/Sales Invoice -> the order on its item rows
    async function pr_resolve_order(frm) {
        const dt = frm.doc.reference_doctype;
        const dn = frm.doc.reference_name;
        const cfg = pr_get_config(dt);
        if (!dn || !cfg) return null;

        if (dt === cfg.order_dt) return { name: dn, cfg };

        if (dt === cfg.invoice_dt) {
            const inv = await frappe.db.get_doc(cfg.invoice_dt, dn);
            const row = (inv.items || []).find((i) => i[cfg.order_link_field]);
            return row ? { name: row[cfg.order_link_field], cfg } : null;
        }

        return null;
    }

    async function pr_load_order_terms(frm, force) {
        try {
            const resolved = await pr_resolve_order(frm);
            if (!resolved) {
                frm.__pr_order_terms = null;
                return;
            }

            const order = await frappe.db.get_doc(resolved.cfg.order_dt, resolved.name);
            const terms = [];
            (order.payment_schedule || []).forEach((s) => {
                if (s.payment_term && !terms.includes(s.payment_term)) terms.push(s.payment_term);
            });
            frm.__pr_order_terms = terms;

            // clear a selected term that does not belong to this order (drafts only)
            if (
                frm.doc.docstatus === 0 &&
                frm.doc[TERM_FIELD] &&
                !terms.includes(frm.doc[TERM_FIELD])
            ) {
                await frm.set_value(TERM_FIELD, "");
            }

            if (frm.doc.docstatus === 0 && resolved.cfg.order_dt === "Sales Order") {
                // Subject: Payment Request for <Sales Order name> - <Customer PO No from SO>
                const po_no = (order.po_no || "").trim();
                const subject = po_no
                    ? `Payment Request for ${order.name} - ${po_no}`
                    : `Payment Request for ${order.name}`;

                if (frm.doc.subject !== subject) {
                    await frm.set_value("subject", subject);
                }

                // Inward requests only: message first, then print format
                if (frm.doc.payment_request_type === "Inward") {
                    // Message (set first so the print format step can never block it)
                    if (force || frm.is_new() || !frm.doc.message) {
                        const customer_name = order.customer_name || frm.doc.party || "";
                        const proforma_invoice_no = order.name; // change here if the proforma number comes from elsewhere
                        const message = pr_inward_message(customer_name, proforma_invoice_no);

                        const current = frm.doc.message || "";
                        // overwrite only if empty or still an earlier auto-generated message
                        const is_auto = !current || current.includes("NMTG Sales Team");
                        if (is_auto && current !== message) {
                            await frm.set_value("message", message);
                        }
                    }

                    // Print format (separate and failure-safe)
                    await pr_set_print_format(frm);
                }
            }
        } catch (e) {
            console.error("Could not load order payment terms:", e);
            frm.__pr_order_terms = null;
        }
    }

    async function pr_set_print_format(frm) {
        try {
            const field = frm.fields_dict.print_format;
            if (!field) {
                console.warn("Payment Request has no print_format field, skipping.");
                return;
            }

            // Select field: make sure our format is one of the options
            if (field.df.fieldtype === "Select") {
                const opts = (field.df.options || "").split("\n");
                if (!opts.includes(PRINT_FORMAT)) {
                    field.df.options = (field.df.options ? field.df.options + "\n" : "") + PRINT_FORMAT;
                    frm.refresh_field("print_format");
                }
            }

            if (frm.doc.print_format !== PRINT_FORMAT) {
                await frm.set_value("print_format", PRINT_FORMAT);
            }
        } catch (e) {
            console.warn("Could not set print format:", e);
        }
    }

    function pr_inward_message(customer_name, proforma_invoice_no) {
        const e = frappe.utils.escape_html;
        return `<p>Dear ${e(customer_name)},</p>
    <p>Greetings from NMTG Mechtrans Techniques Pvt. Ltd.</p>
    <p>With reference to your requirement / order, please find attached our Proforma Invoice ${e(proforma_invoice_no)} for your review and further processing.</p>
    <p>Kindly review the attached Proforma Invoice and confirm your acceptance. In case you require any clarification or amendment, please feel free to reply to this email and our team will be glad to assist you.</p>
    <p>Upon receiving your confirmation, we will proceed with the subsequent order processing activities accordingly.</p>
    <p>Thank you for your continued association with NMTG.</p>
    <p>Best Regards,<br>
    NMTG Sales Team<br>
    NMTG Mechtrans Techniques Pvt. Ltd.<br>
    <a href="https://www.nmtgindia.com">www.nmtgindia.com</a></p>`;
    }

    async function pr_fetch_requests(frm, order_name, cfg) {
        const active = { docstatus: 1, status: ["not in", ["Cancelled", "Failed"]] };

        // Invoices linked to the order (filter on the child table field)
        let inv_names = [];
        try {
            const invs = await frappe.db.get_list(cfg.invoice_dt, {
                filters: [
                    [cfg.invoice_item_dt, cfg.order_link_field, "=", order_name],
                    [cfg.invoice_dt, "docstatus", "=", 1],
                ],
                fields: ["name"],
                limit: 0,
            });
            inv_names = (invs || []).map((r) => r.name);
        } catch (e) {
            console.error("Could not load invoices for order:", e);
        }

        // always include the invoice this request points to
        if (frm.doc.reference_doctype === cfg.invoice_dt && frm.doc.reference_name) {
            if (!inv_names.includes(frm.doc.reference_name)) {
                inv_names.push(frm.doc.reference_name);
            }
        }

        const lists = [];
        lists.push(
            await frappe.db.get_list("Payment Request", {
                filters: Object.assign(
                    { reference_doctype: cfg.order_dt, reference_name: order_name },
                    active
                ),
                fields: ["name"],
                limit: 0,
            })
        );
        if (inv_names.length) {
            lists.push(
                await frappe.db.get_list("Payment Request", {
                    filters: Object.assign(
                        { reference_doctype: cfg.invoice_dt, reference_name: ["in", inv_names] },
                        active
                    ),
                    fields: ["name"],
                    limit: 0,
                })
            );
        }

        const names = [...new Set([].concat(...lists).map((r) => r.name))];
        const prqs = await Promise.all(names.map((n) => frappe.db.get_doc("Payment Request", n)));
        prqs.sort((a, b) => String(a.creation || "").localeCompare(String(b.creation || "")));
        return prqs;
    }

    async function pr_terms_v6_render(frm) {
        const field = frm.fields_dict[FIELD];
        if (!field) return;
        const $wrapper = field.$wrapper;

        if (!frm.doc.reference_doctype || !frm.doc.reference_name) {
            $wrapper.html("");
            return;
        }

        // guard against overlapping async renders
        const token = (frm.__pr_terms_token = (frm.__pr_terms_token || 0) + 1);

        try {
            const resolved = await pr_resolve_order(frm);
            if (!resolved) {
                $wrapper.html("");
                return;
            }
            const cfg = resolved.cfg;

            const po = await frappe.db.get_doc(cfg.order_dt, resolved.name);
            const prqs = await pr_fetch_requests(frm, resolved.name, cfg);

            if (token !== frm.__pr_terms_token) return; // a newer render started

            const schedule = po.payment_schedule || [];
            const schedule_ids = new Set(schedule.map((s) => s.name));
            const term_by_id = {};
            schedule.forEach((s) => (term_by_id[s.name] = s.payment_term));

            const currency = po.currency || frm.doc.currency;
            const net_total = flt(po.net_total);
            const total_tax = flt(po.total_taxes_and_charges);
            const grand_total = flt(po.rounded_total || po.grand_total);
            const fmt = (v) => format_currency(v, currency);
            const esc = frappe.utils.escape_html;

            const items_part_of = (amount) =>
                grand_total ? flt((amount * net_total) / grand_total, 2) : 0;

            // Requested / paid amounts per payment schedule row
            const by_schedule = {};
            const add = (key, requested, paid) => {
                const e = (by_schedule[key] = by_schedule[key] || { requested: 0, paid: 0 });
                e.requested += requested;
                e.paid += paid;
            };

            const paid_ratio = (prq) => {
                const total = flt(prq.grand_total);
                if (prq.status === "Paid") return 1;
                if (!total) return 0;
                return Math.max(0, Math.min(1, (total - flt(prq.outstanding_amount)) / total));
            };

            const claimed = new Set(); // schedule rows already linked to a request
            const prq_alloc = {}; // payment request name -> [schedule row ids]
            const prq_how = {}; // payment request name -> how it was linked
            const link = (prq, key, how) => {
                (prq_alloc[prq.name] = prq_alloc[prq.name] || []).push(key);
                prq_how[prq.name] = how;
                claimed.add(key);
            };

            // Pass 1: requests that reference a payment term (by schedule id, else by term name)
            prqs.forEach((prq) => {
                const ratio = paid_ratio(prq);
                (prq.payment_reference || []).forEach((ref) => {
                    let key = ref.payment_schedule;
                    if (!key || !schedule_ids.has(key)) {
                        const match = schedule.find((s) => s.payment_term === ref.payment_term);
                        key = match ? match.name : null;
                    }
                    if (!key) return;

                    add(key, flt(ref.amount), flt(ref.amount) * ratio);
                    link(prq, key, "Linked");
                });
            });

            // Pass 2: requests without payment term rows but with the Payment Term field set.
            // Several requests may share the same term (e.g. Before Dispatch paid in parts),
            // so prefer an unclaimed row, else fall back to the same term even if already claimed.
            const unlinked = prqs.filter((prq) => !(prq.payment_reference || []).length);

            unlinked.forEach((prq) => {
                if (prq_alloc[prq.name] || !prq[TERM_FIELD]) return;
                const total = flt(prq.grand_total);
                const match =
                    schedule.find(
                        (s) => !claimed.has(s.name) && s.payment_term === prq[TERM_FIELD]
                    ) || schedule.find((s) => s.payment_term === prq[TERM_FIELD]);
                if (!match) return;
                add(match.name, total, total * paid_ratio(prq));
                link(prq, match.name, "Payment Term field");
            });

            // Pass 3: remaining requests -> amount equals the term total
            unlinked.forEach((prq) => {
                if (prq_alloc[prq.name]) return;
                const total = flt(prq.grand_total);
                const match = schedule.find(
                    (s) => !claimed.has(s.name) && Math.abs(flt(s.payment_amount) - total) < 0.01
                );
                if (!match) return;
                add(match.name, total, total * paid_ratio(prq));
                link(prq, match.name, "Matched by term total");
            });

            // Pass 4: remaining requests -> amount equals the items-only part of a term
            unlinked.forEach((prq) => {
                if (prq_alloc[prq.name]) return;
                const total = flt(prq.grand_total);
                const match = schedule.find(
                    (s) =>
                        !claimed.has(s.name) &&
                        Math.abs(items_part_of(flt(s.payment_amount)) - total) < 0.01
                );
                if (!match) return;
                add(match.name, total, total * paid_ratio(prq));
                link(prq, match.name, "Matched by items-only amount");
            });

            // highlight the term(s) of the Payment Request being viewed
            const current_ids = new Set(prq_alloc[frm.doc.name] || []);
            if (!current_ids.size) {
                // draft / unsaved request: use the selected Payment Term, else its own term rows
                if (frm.doc[TERM_FIELD]) {
                    const match = schedule.find((s) => s.payment_term === frm.doc[TERM_FIELD]);
                    if (match) current_ids.add(match.name);
                }
                (frm.doc.payment_reference || []).forEach((ref) => {
                    if (ref.payment_schedule && schedule_ids.has(ref.payment_schedule)) {
                        current_ids.add(ref.payment_schedule);
                    } else {
                        const match = schedule.find((s) => s.payment_term === ref.payment_term);
                        if (match) current_ids.add(match.name);
                    }
                });
            }

            let sum_items = 0,
                sum_tax = 0,
                sum_total = 0,
                sum_requested = 0,
                sum_paid = 0,
                sum_outstanding = 0;

            const rows = schedule
                .map((ps) => {
                    const amount = flt(ps.payment_amount);
                    const items_part = items_part_of(amount);
                    const tax_part = flt(amount - items_part, 2);

                    const e = by_schedule[ps.name] || { requested: 0, paid: 0 };
                    const paid = Math.max(flt(e.paid, 2), flt(ps.paid_amount));
                    const outstanding = flt(amount - paid, 2);

                    let status = "Not Requested";
                    let color = "text-muted";
                    if (amount > 0 && paid >= amount - 0.01) {
                        status = "Paid";
                        color = "text-success";
                    } else if (paid > 0) {
                        status = "Partially Paid";
                        color = "text-warning";
                    } else if (e.requested > 0) {
                        status = "Requested";
                        color = "text-info";
                    }

                    sum_items += items_part;
                    sum_tax += tax_part;
                    sum_total += amount;
                    sum_requested += e.requested;
                    sum_paid += paid;
                    sum_outstanding += outstanding;

                    const is_current = current_ids.has(ps.name);

                    return `
                        <tr style="${is_current ? "background:#fff8e1;font-weight:600;" : ""}">
                            <td>${esc(ps.payment_term || "")}</td>
                            <td class="text-right">${flt(ps.invoice_portion)}%</td>
                            <td>${ps.due_date ? frappe.datetime.str_to_user(ps.due_date) : ""}</td>
                            <td class="text-right">${fmt(items_part)}</td>
                            <td class="text-right">${fmt(tax_part)}</td>
                            <td class="text-right">${fmt(amount)}</td>
                            <td class="text-right">${fmt(e.requested)}</td>
                            <td class="text-right">${fmt(paid)}</td>
                            <td class="text-right">${fmt(outstanding)}</td>
                            <td class="${color}">${status}</td>
                        </tr>`;
                })
                .join("");

            const prq_rows = prqs
                .map((prq) => {
                    const keys = prq_alloc[prq.name] || [];
                    const terms = keys.map((k) => esc(term_by_id[k] || "")).join(", ");
                    const is_this = prq.name === frm.doc.name;
                    return `
                        <tr style="${is_this ? "background:#fff8e1;font-weight:600;" : ""}">
                            <td><a href="/app/payment-request/${encodeURIComponent(prq.name)}">${esc(prq.name)}</a></td>
                            <td>${esc(prq.reference_doctype || "")}: ${esc(prq.reference_name || "")}</td>
                            <td class="text-right">${fmt(prq.grand_total)}</td>
                            <td>${esc(prq.status || "")}</td>
                            <td>${
                                terms
                                    ? `${terms} <span class="text-muted small">(${esc(prq_how[prq.name])})</span>`
                                    : '<span class="text-danger">Not linked to any payment term</span>'
                            }</td>
                        </tr>`;
                })
                .join("");

            const html = `
                <div style="overflow-x:auto; margin-bottom:10px;">
                    <table class="table table-bordered table-hover" style="margin-bottom:0;">
                        <thead>
                            <tr>
                                <th>Payment Term</th>
                                <th class="text-right">Portion</th>
                                <th>Due Date</th>
                                <th class="text-right">Against Items</th>
                                <th class="text-right">Taxes</th>
                                <th class="text-right">Total</th>
                                <th class="text-right">Requested</th>
                                <th class="text-right">Paid</th>
                                <th class="text-right">Outstanding</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                                rows ||
                                '<tr><td colspan="10" class="text-muted text-center">No payment schedule found</td></tr>'
                            }
                        </tbody>
                        <tfoot>
                            <tr style="font-weight:700;">
                                <td colspan="3">Total</td>
                                <td class="text-right">${fmt(sum_items)}</td>
                                <td class="text-right">${fmt(sum_tax)}</td>
                                <td class="text-right">${fmt(sum_total)}</td>
                                <td class="text-right">${fmt(sum_requested)}</td>
                                <td class="text-right">${fmt(sum_paid)}</td>
                                <td class="text-right">${fmt(sum_outstanding)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                    ${
                        prq_rows
                            ? `<table class="table table-bordered" style="margin:10px 0 0;">
                                <thead>
                                    <tr>
                                        <th>Payment Request</th>
                                        <th>Against</th>
                                        <th class="text-right">Amount</th>
                                        <th>Status</th>
                                        <th>Linked Payment Term</th>
                                    </tr>
                                </thead>
                                <tbody>${prq_rows}</tbody>
                            </table>`
                            : ""
                    }
                    <div class="text-muted small" style="margin-top:6px;">
                        ${esc(po.name)} &mdash; Items Total: ${fmt(net_total)} | Taxes: ${fmt(total_tax)} | Grand Total: ${fmt(grand_total)}
                        <span style="float:right; opacity:.5;">v9</span>
                    </div>
                </div>`;

            $wrapper.html(html);
        } catch (e) {
            console.error("Payment terms render failed:", e);
            $wrapper.html(
                '<div class="text-muted">Unable to load payment terms. Check the browser console for details.</div>'
            );
        }
    }
})();


frappe.ui.form.on("Payment Request CT", {
    before_dispatch_ready_qty(frm) {
        render_item_payment(frm);
    },
    item_code(frm) {
        render_item_payment(frm);
    },
});

function esc(v) {
    return frappe.utils.escape_html(v == null ? "" : String(v));
}

// Percentage from the Payment Term (invoice_portion); falls back to parsing "20% ..." from its name
async function get_payment_percent(term) {
    if (!term) return 0;
    try {
        const r = await frappe.db.get_value("Payment Term", term, "invoice_portion");
        const p = flt(r && r.message && r.message.invoice_portion);
        if (p) return p;
    } catch (e) {
        // ignore and fall back to name parsing
    }
    const m = String(term).match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? flt(m[1]) : 0;
}

async function render_item_payment(frm) {
    const field = frm.fields_dict.custom_item_payment;
    if (!field) return;
    const $wrap = field.$wrapper;

    const rows = frm.doc.custom_items || [];
    const order_dt = frm.doc.reference_doctype;

    if (
        !["Purchase Order", "Sales Order"].includes(order_dt) ||
        !frm.doc.reference_name ||
        !rows.length
    ) {
        $wrap.html("");
        return;
    }

    // Guard against out-of-order async responses
    const token = (frm.__item_payment_token = (frm.__item_payment_token || 0) + 1);

    let po;
    try {
        const r = await frappe.call({
            method: "frappe.client.get",
            args: { doctype: order_dt, name: frm.doc.reference_name },
        });
        po = r.message;
    } catch (e) {
        $wrap.html(`<div class="text-muted">Could not load ${esc(order_dt)} ${esc(frm.doc.reference_name)}.</div>`);
        return;
    }
    if (token !== frm.__item_payment_token || !po) return;

    const percent = await get_payment_percent(frm.doc.custom_payment_term);
    if (token !== frm.__item_payment_token) return;

    const currency = frm.doc.currency || po.currency;
    const fmt = (v) => format_currency(v, currency);

    // Tax factor from the order: (net total + total taxes) / net total
    const po_net_total = flt(po.net_total) || flt(po.total);
    const po_taxes = flt(po.total_taxes_and_charges);
    const tax_factor = po_net_total ? (po_net_total + po_taxes) / po_net_total : 1;
    const tax_percent = (tax_factor - 1) * 100;

    let total_po_amount = 0;
    let total_ready_amount = 0;
    let total_ready_with_tax = 0;
    let total_payable = 0;
    let total_payable_with_tax = 0;

    const body = rows.map((row) => {
        const po_item = (po.items || []).find((i) => i.item_code === row.item_code);

        const po_qty = flt(row.po_qty || (po_item && po_item.qty));
        const ready_qty = flt(row.before_dispatch_ready_qty);
        const rate = po_item ? flt(po_item.rate) : 0;

        const po_amount = po_qty * rate;
        const ready_amount = ready_qty * rate;
        const ready_with_tax = ready_amount * tax_factor;
        const payable = ready_amount * percent / 100;
        const payable_with_tax = payable * tax_factor;

        total_po_amount += po_amount;
        total_ready_amount += ready_amount;
        total_ready_with_tax += ready_with_tax;
        total_payable += payable;
        total_payable_with_tax += payable_with_tax;

        const qty_warn = ready_qty > po_qty
            ? ' style="color:#d9534f;font-weight:600;"' : "";

        return `
            <tr>
                <td>${row.idx}</td>
                <td>${esc(row.item_code)}</td>
                <td>${esc(row.item_name)}</td>
                <td class="text-right">${po_qty}</td>
                <td class="text-right"${qty_warn}>${ready_qty}</td>
                <td class="text-right">${po_item ? fmt(rate) : '<span class="text-muted">Not in order</span>'}</td>
                <td class="text-right">${fmt(po_amount)}</td>
                <td class="text-right">${fmt(ready_amount)}</td>
                <td class="text-right">${fmt(ready_with_tax)}</td>
                <td class="text-right"><b>${fmt(payable)}</b></td>
                <td class="text-right"><b>${fmt(payable_with_tax)}</b></td>
            </tr>`;
    }).join("");

    const html = `
        <div style="margin-bottom:8px;">
            <span class="text-muted">${esc(order_dt)}:</span> <b>${esc(po.name)}</b>
            &nbsp;|&nbsp;
            <span class="text-muted">Payment Term:</span> <b>${esc(frm.doc.custom_payment_term || "-")}</b>
            &nbsp;|&nbsp;
            <span class="text-muted">Payment %:</span> <b>${percent}%</b>
            &nbsp;|&nbsp;
            <span class="text-muted">Tax:</span> <b>${flt(tax_percent, 2)}%</b>
        </div>
        <div style="overflow-x:auto;">
            <table class="table table-bordered table-sm" style="margin-bottom:0;">
                <thead style="background:var(--control-bg, #f5f5f5);">
                    <tr>
                        <th>#</th>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th class="text-right">Order Qty</th>
                        <th class="text-right">Ready Qty</th>
                        <th class="text-right">Rate</th>
                        <th class="text-right">Order Amount</th>
                        <th class="text-right">Ready Amount</th>
                        <th class="text-right">Ready Amount (incl. Tax)</th>
                        <th class="text-right">Payable (${percent}%)</th>
                        <th class="text-right">Payable (${percent}%) incl. Tax</th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
                <tfoot>
                    <tr style="font-weight:600;">
                        <td colspan="6" class="text-right">Total</td>
                        <td class="text-right">${fmt(total_po_amount)}</td>
                        <td class="text-right">${fmt(total_ready_amount)}</td>
                        <td class="text-right">${fmt(total_ready_with_tax)}</td>
                        <td class="text-right">${fmt(total_payable)}</td>
                        <td class="text-right">${fmt(total_payable_with_tax)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>`;

    $wrap.html(html);
}