(function () {
    const FIELD = "custom_payment_terms"; // HTML field that shows the table
    const TERM_FIELD = "custom_payment_term"; // Link field to Payment Term

    frappe.ui.form.on("Payment Request", {
        setup(frm) {
            // Only offer payment terms that exist in the reference PO's payment schedule
            frm.set_query(TERM_FIELD, function () {
                if (frm.doc.reference_doctype !== "Purchase Order" || !frm.doc.reference_name) {
                    return {};
                }
                const terms = frm.__pr_po_terms || [];
                return { filters: { name: ["in", terms.length ? terms : ["__none__"] ] } };
            });
        },
        async refresh(frm) {
            await pr_load_po_terms(frm);
            pr_terms_v6_render(frm);
        },
        async reference_name(frm) {
            await pr_load_po_terms(frm);
            pr_terms_v6_render(frm);
        },
        async reference_doctype(frm) {
            await pr_load_po_terms(frm);
            pr_terms_v6_render(frm);
        },
        custom_payment_term(frm) {
            pr_terms_v6_render(frm);
        },
        after_save(frm) {
            pr_terms_v6_render(frm);
        },
    });

    // Load the payment terms of the referenced Purchase Order (used by the Link filter)
    async function pr_load_po_terms(frm) {
        if (frm.doc.reference_doctype !== "Purchase Order" || !frm.doc.reference_name) {
            frm.__pr_po_terms = null;
            return;
        }
        try {
            const po = await frappe.db.get_doc("Purchase Order", frm.doc.reference_name);
            const terms = [];
            (po.payment_schedule || []).forEach((s) => {
                if (s.payment_term && !terms.includes(s.payment_term)) terms.push(s.payment_term);
            });
            frm.__pr_po_terms = terms;

            // clear a selected term that does not belong to this PO (drafts only)
            if (
                frm.doc.docstatus === 0 &&
                frm.doc[TERM_FIELD] &&
                !terms.includes(frm.doc[TERM_FIELD])
            ) {
                await frm.set_value(TERM_FIELD, "");
            }
        } catch (e) {
            console.error("Could not load PO payment terms:", e);
            frm.__pr_po_terms = null;
        }
    }

    async function pr_terms_v6_render(frm) {
        const field = frm.fields_dict[FIELD];
        if (!field) return;
        const $wrapper = field.$wrapper;

        if (frm.doc.reference_doctype !== "Purchase Order" || !frm.doc.reference_name) {
            $wrapper.html("");
            return;
        }

        // guard against overlapping async renders
        const token = (frm.__pr_terms_token = (frm.__pr_terms_token || 0) + 1);

        try {
            const po = await frappe.db.get_doc("Purchase Order", frm.doc.reference_name);

            // All active (submitted, not cancelled/failed) Payment Requests against this PO
            const prq_list = await frappe.db.get_list("Payment Request", {
                filters: {
                    reference_doctype: "Purchase Order",
                    reference_name: frm.doc.reference_name,
                    docstatus: 1,
                    status: ["not in", ["Cancelled", "Failed"]],
                },
                fields: ["name"],
                limit: 0,
            });

            const prqs = await Promise.all(
                prq_list.map((r) => frappe.db.get_doc("Payment Request", r.name))
            );
            prqs.sort((a, b) => String(a.creation || "").localeCompare(String(b.creation || "")));

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

            // Requested / paid amounts per PO payment schedule row
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

            // Pass 2: requests without payment term rows but with the Payment Term field set
            const unlinked = prqs.filter((prq) => !(prq.payment_reference || []).length);

            unlinked.forEach((prq) => {
                if (prq_alloc[prq.name] || !prq[TERM_FIELD]) return;
                const total = flt(prq.grand_total);
                const match = schedule.find(
                    (s) => !claimed.has(s.name) && s.payment_term === prq[TERM_FIELD]
                );
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
                        <span style="float:right; opacity:.5;">v6</span>
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