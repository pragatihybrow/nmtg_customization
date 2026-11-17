
import frappe
from frappe import _
import json
from frappe.utils import flt, nowdate
from frappe.utils import flt, get_url_to_form


@frappe.whitelist()
def create_so_payment_request(so, payment_term):
    """Create an (Inward) Payment Request against a Sales Order
    for the amount of the selected payment term."""

    so_doc = frappe.get_doc("Sales Order", so)

    frappe.has_permission("Sales Order", "read", doc=so_doc, throw=True)
    frappe.has_permission("Payment Request", "create", throw=True)

    if so_doc.docstatus != 1:
        frappe.throw(_("Sales Order must be submitted to create a Payment Request."))

    term_row = next(
        (row for row in so_doc.payment_schedule if row.payment_term == payment_term),
        None,
    )

    if not term_row:
        frappe.throw(
            _("Payment Term {0} not found in Sales Order {1}").format(
                frappe.bold(payment_term), so
            )
        )

    # Amount still to be requested for this term
    amount = flt(term_row.payment_amount) - flt(term_row.paid_amount)

    if amount <= 0:
        frappe.throw(
            _("Payment Term {0} is already fully paid.").format(frappe.bold(payment_term))
        )

    # Payment term can live in the standard field, the custom field, or both
    meta = frappe.get_meta("Payment Request")
    term_fields = [f for f in ("payment_term", "custom_payment_term") if meta.has_field(f)]

    # Block duplicate requests for the same term
    for fieldname in term_fields:
        existing = frappe.db.get_value(
            "Payment Request",
            {
                "reference_doctype": "Sales Order",
                "reference_name": so,
                fieldname: payment_term,
                "docstatus": ["<", 2],
            },
            "name",
        )

        if existing:
            frappe.throw(
                _("Payment Request {0} already exists for Payment Term {1}.").format(
                    frappe.bold(existing), frappe.bold(payment_term)
                )
            )

    pr = frappe.new_doc("Payment Request")
    pr.payment_request_type = "Inward"
    pr.party_type = "Customer"
    pr.party = so_doc.customer
    pr.company = so_doc.company
    pr.transaction_date = nowdate()
    pr.reference_doctype = "Sales Order"
    pr.reference_name = so_doc.name
    pr.currency = so_doc.currency
    pr.grand_total = amount
    pr.email_to = so_doc.contact_email or ""
    pr.subject = _("Payment Request for {0} - {1}").format(so_doc.name, payment_term)

    for fieldname in term_fields:
        pr.set(fieldname, payment_term)

    pr.insert()

    
    for fieldname in term_fields:
        if pr.get(fieldname) != payment_term:
            pr.db_set(fieldname, payment_term, update_modified=False)

    return pr.name

@frappe.whitelist()
def sales_order_stock_allocation(item_codes, company, sales_order=None):
    frappe.has_permission("Sales Order", "read", throw=True)

    if isinstance(item_codes, str):
        item_codes = [i.strip() for i in item_codes.split(",") if i.strip()]

    if not item_codes or not company:
        return []

    params = {
        "items": tuple(item_codes),
        "company": company,
        "current": sales_order or "",
    }

    stock_rows = frappe.db.sql(
        """
        SELECT b.item_code, SUM(b.actual_qty) AS qty
        FROM `tabBin` b
        INNER JOIN `tabWarehouse` w ON w.name = b.warehouse
        WHERE b.item_code IN %(items)s AND w.company = %(company)s
        GROUP BY b.item_code
        """,
        params,
        as_dict=1,
    )

    so_rows = frappe.db.sql(
        """
        SELECT soi.item_code,
               so.name AS sales_order,
               so.customer,
               so.customer_name,
               so.transaction_date,
               so.delivery_date,
               so.status,
               so.docstatus,
               SUM(soi.qty * soi.conversion_factor) AS qty,
               SUM((soi.qty - IFNULL(soi.delivered_qty, 0)) * soi.conversion_factor) AS pending_qty
        FROM `tabSales Order Item` soi
        INNER JOIN `tabSales Order` so ON so.name = soi.parent
        WHERE soi.item_code IN %(items)s
          AND so.company = %(company)s
          AND so.docstatus < 2
          AND so.name != %(current)s
          AND so.status NOT IN ('Closed', 'Completed', 'Cancelled', 'On Hold')
          AND soi.qty > IFNULL(soi.delivered_qty, 0)
        GROUP BY soi.item_code, so.name, so.customer, so.customer_name,
                 so.transaction_date, so.delivery_date, so.status, so.docstatus
        ORDER BY so.transaction_date
        """,
        params,
        as_dict=1,
    )

    stock_map = {r.item_code: flt(r.qty) for r in stock_rows}

    so_map = {}
    for r in so_rows:
        so_map.setdefault(r.item_code, []).append(
            {
                "sales_order": r.sales_order,
                "customer": r.customer_name or r.customer,
                "date": str(r.transaction_date),
                "delivery_date": str(r.delivery_date) if r.delivery_date else "",
                "status": r.status,
                "docstatus": r.docstatus,
                "qty": flt(r.qty),
                "pending_qty": flt(r.pending_qty),
            }
        )

    result = []
    for code in item_codes:
        orders = so_map.get(code, [])
        total_pending = sum(o["pending_qty"] for o in orders)
        in_stock = stock_map.get(code, 0)
        result.append(
            {
                "item_code": code,
                "in_stock": in_stock,
                "pending_total": total_pending,
                "available": in_stock - total_pending,
                "orders": orders,
            }
        )

    return result


@frappe.whitelist()
def update_terms_and_conditions(tc_name, terms):
    frappe.has_permission("Terms and Conditions", "write", throw=True)

    doc = frappe.get_doc("Terms and Conditions", tc_name)
    if (doc.terms or "") != (terms or ""):
        doc.terms = terms
        doc.save()

    return doc.name


@frappe.whitelist()
def update_item_hold_status(sales_order, items, action, remark=None):
    """items: list of {"row_name": ..., "remark": ...}"""
    items = frappe.parse_json(items) if isinstance(items, str) else items
    items = items or []

    if action not in ("hold", "unhold"):
        frappe.throw(_("Invalid action."))

    so = frappe.get_doc("Sales Order", sales_order)
    so.check_permission("write")

    if so.docstatus != 1:
        frappe.throw(_("Sales Order must be submitted."))

    rows_by_name = {r.name: r for r in so.items}
    has_unhold_remark = frappe.get_meta("Sales Order Item").has_field("custom_unhold_remark")
    updated = 0
    changed_rows = []

    for entry in items:
        row = rows_by_name.get(entry.get("row_name"))
        if not row:
            continue

        item_remark = (entry.get("remark") or remark or "").strip()
        if not item_remark:
            frappe.throw(_("Row {0}: remark is required.").format(row.idx))

        if flt(row.delivered_qty) >= flt(row.qty):
            frappe.throw(
                _("Row {0}: item {1} is already delivered and cannot be put on hold or released.").format(
                    row.idx, row.item_code
                )
            )

        if action == "hold":
            values = {"custom_status": "On Hold", "custom_hold_remark": item_remark}
        else:
            values = {"custom_status": "", "custom_hold_remark": ""}
            if has_unhold_remark:
                values["custom_unhold_remark"] = item_remark

        frappe.db.set_value("Sales Order Item", row.name, values, update_modified=True)

        changed_rows.append(
            {
                "row_name": row.name,
                "idx": row.idx,
                "item_code": row.item_code,
                "item_name": row.item_name,
                "qty": row.qty,
                "remark": item_remark,
            }
        )
        updated += 1

    if changed_rows:
        notify_production_plan_creators(sales_order, changed_rows, action)

    return {"updated": updated}


def notify_production_plan_creators(sales_order, changed_rows, action):
    try:
        is_hold = action == "hold"
        status_text = _("put on hold") if is_hold else _("released from hold")
        status_label = _("On Hold") if is_hold else _("Released from Hold")
        remark_label = _("Hold Remark") if is_hold else _("Unhold Remark")

        rows_by_name = {r["row_name"]: r for r in changed_rows}

        plan_items = frappe.get_all(
            "Production Plan Item",
            filters={
                "sales_order": sales_order,
                "sales_order_item": ["in", list(rows_by_name.keys())],
            },
            fields=["parent", "sales_order_item", "planned_qty"],
            parent_doctype="Production Plan",
        )
        if not plan_items:
            return

        # Group the affected rows by Production Plan
        plans = {}
        for pi in plan_items:
            changed = rows_by_name.get(pi.sales_order_item)
            if not changed:
                continue
            plans.setdefault(pi.parent, []).append({**changed, "planned_qty": pi.planned_qty})

        acted_by = frappe.utils.get_fullname(frappe.session.user)
        esc = frappe.utils.escape_html

        for plan_name, rows in plans.items():
            plan = frappe.db.get_value(
                "Production Plan",
                plan_name,
                ["owner", "docstatus", "status"],
                as_dict=True,
            )
            # Skip cancelled / closed / completed plans
            if not plan or plan.docstatus == 2 or plan.status in ("Closed", "Completed", "Cancelled"):
                continue

            creator = plan.owner
            creator_name = frappe.utils.get_fullname(creator)
            plan_url = get_url_to_form("Production Plan", plan_name)
            so_url = get_url_to_form("Sales Order", sales_order)

            # ---- Comment with @mention ----
            mention = (
                f'<span class="mention" data-id="{esc(creator)}" '
                f'data-value="{esc(creator_name)}" data-denotation-char="@">'
                f'<span><span class="ql-mention-denotation-char">@</span>'
                f"{esc(creator_name)}</span></span>"
            )
            lines = "".join(
                f"<li>Row {r['idx']}: <b>{esc(r['item_code'])}</b> - {esc(r['remark'])}</li>"
                for r in rows
            )
            comment_html = (
                f"<p>{mention} Sales Order <b>{sales_order}</b> item(s) were {status_text} "
                f"by {esc(acted_by)}:</p><ul>{lines}</ul>"
            )
            frappe.get_doc("Production Plan", plan_name).add_comment("Comment", comment_html)

            # ---- Email ----
            recipient = frappe.db.get_value("User", creator, "email")
            if not recipient:
                continue

            table_rows = "".join(
                f"<tr>"
                f"<td>{r['idx']}</td>"
                f"<td>{esc(r['item_code'])}</td>"
                f"<td>{esc(r['item_name'] or '')}</td>"
                f"<td style='text-align:right'>{flt(r['planned_qty'])}</td>"
                f"<td>{esc(r['remark'])}</td>"
                f"</tr>"
                for r in rows
            )
            closing = (
                _("Please review the production plan accordingly.")
                if is_hold
                else _("These items can proceed again. Please review the production plan accordingly.")
            )
            message = f"""
                <p>Hello {esc(creator_name)},</p>
                <p>The following item(s) of Sales Order <a href="{so_url}">{sales_order}</a>
                were <b>{status_label}</b> by {esc(acted_by)}.
                You have created Production Plan <a href="{plan_url}">{plan_name}</a> against them.</p>
                <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
                    <thead>
                        <tr>
                            <th>Row</th><th>Item Code</th><th>Item Name</th>
                            <th>Planned Qty</th><th>{remark_label}</th>
                        </tr>
                    </thead>
                    <tbody>{table_rows}</tbody>
                </table>
                <p>{closing}</p>
            """

            frappe.sendmail(
                recipients=[recipient],
                subject=_("Sales Order {0} item(s) {1} - Production Plan {2}").format(
                    sales_order, status_text, plan_name
                ),
                message=message,
                reference_doctype="Production Plan",
                reference_name=plan_name,
            )
    except Exception:
        frappe.log_error(
            frappe.get_traceback(), "Hold/Unhold Item - Production Plan Notification Failed"
        )