# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, getdate, today, date_diff


def execute(filters=None):
    filters = filters or {}
    return get_columns(), get_data(filters)


def get_columns():
    return [
        {"label": _("Sales Order / Installment"), "fieldname": "name", "fieldtype": "Data", "width": 220},
        {"label": _("SO Date"), "fieldname": "so_date", "fieldtype": "Date", "width": 100},
        {"label": _("Customer"), "fieldname": "customer_name", "fieldtype": "Data", "width": 200},
        {"label": _("Delivery Date"), "fieldname": "delivery_date", "fieldtype": "Date", "width": 110},
        {"label": _("Order Total"), "fieldname": "order_total", "fieldtype": "Currency", "width": 130},
        {"label": _("Payment Term"), "fieldname": "payment_term", "fieldtype": "Data", "width": 200},
        {"label": _("Description"), "fieldname": "description", "fieldtype": "Data", "width": 180},
        {"label": _("Due Date"), "fieldname": "due_date", "fieldtype": "Date", "width": 110},
        {"label": _("Portion %"), "fieldname": "portion", "fieldtype": "Percent", "width": 90},
        {"label": _("Amount To Receive"), "fieldname": "amount", "fieldtype": "Currency", "width": 150},
        {"label": _("Received Amount"), "fieldname": "received", "fieldtype": "Currency", "width": 140},
        {"label": _("Outstanding"), "fieldname": "outstanding", "fieldtype": "Currency", "width": 130},
        {"label": _("Last Received Date"), "fieldname": "last_received_date", "fieldtype": "Date", "width": 130},
        {"label": _("Days Overdue"), "fieldname": "days_overdue", "fieldtype": "Int", "width": 100},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 110},
    ]


def norm_term(value):
    """Normalise a payment term name (collapse repeated spaces) for comparison."""
    return " ".join((value or "").split())


def get_si_so_map(so_names):
    if not so_names:
        return {}
    rows = frappe.db.sql(
        """
        SELECT DISTINCT sii.parent AS sales_invoice, sii.sales_order
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.docstatus = 1
            AND sii.sales_order IN %(sos)s
        """,
        {"sos": tuple(so_names)},
        as_dict=True,
    )
    result = {}
    for r in rows:
        result.setdefault(r.sales_invoice, set()).add(r.sales_order)
    return result


def get_received(so_names):
   
    if not so_names:
        return {}

    if frappe.db.has_column("Payment Entry", "custom_payment_term"):
        pe_term_select = "pe.custom_payment_term"
    else:
        pe_term_select = "NULL"

    select_sql = """
        SELECT
            per.reference_name,
            per.payment_term,
            per.allocated_amount,
            pe.posting_date,
            {pe_term_select} AS pe_term
        FROM `tabPayment Entry Reference` per
        INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
        WHERE pe.docstatus = 1
            AND pe.payment_type = 'Receive'
            AND per.reference_doctype = %(doctype)s
            AND per.reference_name IN %(names)s
    """.format(pe_term_select=pe_term_select)

    entries = []  # (so, term, amount, date)

    for e in frappe.db.sql(
        select_sql, {"doctype": "Sales Order", "names": tuple(so_names)}, as_dict=True
    ):
        entries.append((e.reference_name, e, ))

    si_to_sos = get_si_so_map(so_names)
    if si_to_sos:
        for e in frappe.db.sql(
            select_sql, {"doctype": "Sales Invoice", "names": tuple(si_to_sos.keys())}, as_dict=True
        ):
            sos = si_to_sos.get(e.reference_name, set())
            # only attribute when the invoice belongs to exactly one Sales Order
            if len(sos) == 1:
                entries.append((next(iter(sos)), e))

    result = {}
    for so, e in entries:
        d = result.setdefault(
            so, {"by_term": {}, "by_term_date": {}, "no_term": 0, "no_term_date": None}
        )
        term = norm_term(e.payment_term) or norm_term(e.pe_term)
        amt = flt(e.allocated_amount)
        if term:
            d["by_term"][term] = d["by_term"].get(term, 0) + amt
            cur = d["by_term_date"].get(term)
            if amt > 0 and e.posting_date and (not cur or e.posting_date > cur):
                d["by_term_date"][term] = e.posting_date
        else:
            d["no_term"] += amt
            cur = d["no_term_date"]
            if amt > 0 and e.posting_date and (not cur or e.posting_date > cur):
                d["no_term_date"] = e.posting_date
    return result


def row_status(amount, outstanding, received, due_date, today_date):
    if flt(outstanding) <= 0.005:
        return "Paid"
    if due_date and getdate(due_date) < today_date:
        return "Overdue"
    if flt(received) > 0:
        return "Partly Paid"
    return "Pending"


def get_data(filters):
    conditions = ["so.docstatus = 1", "so.status NOT IN ('Closed', 'Cancelled')"]
    values = {}

    if filters.get("company"):
        conditions.append("so.company = %(company)s")
        values["company"] = filters["company"]
    if filters.get("customer"):
        conditions.append("so.customer = %(customer)s")
        values["customer"] = filters["customer"]
    if filters.get("sales_order"):
        conditions.append("so.name = %(sales_order)s")
        values["sales_order"] = filters["sales_order"]
    if filters.get("from_date"):
        conditions.append("so.transaction_date >= %(from_date)s")
        values["from_date"] = filters["from_date"]
    if filters.get("to_date"):
        conditions.append("so.transaction_date <= %(to_date)s")
        values["to_date"] = filters["to_date"]

    schedule_rows = frappe.db.sql(
        """
        SELECT
            so.name AS sales_order,
            so.transaction_date AS so_date,
            so.customer_name,
            so.delivery_date,
            COALESCE(NULLIF(so.rounded_total, 0), so.grand_total) AS order_total,
            ps.name AS schedule_name,
            ps.payment_term,
            ps.description,
            ps.due_date,
            ps.invoice_portion,
            ps.payment_amount,
            ps.paid_amount
        FROM `tabSales Order` so
        INNER JOIN `tabPayment Schedule` ps
            ON ps.parent = so.name AND ps.parenttype = 'Sales Order'
        WHERE {conditions}
        ORDER BY so.transaction_date DESC, so.name, ps.due_date, ps.idx
        """.format(conditions=" AND ".join(conditions)),
        values,
        as_dict=True,
    )

    grouped = {}
    for r in schedule_rows:
        grouped.setdefault(r.sales_order, []).append(r)

    received_map = get_received(list(grouped.keys()))
    today_date = getdate(today())
    status_filter = filters.get("status")

    data = []
    for so, rows in grouped.items():
        rec = received_map.get(so, {"by_term": {}, "by_term_date": {}, "no_term": 0, "no_term_date": None})
        term_pool = dict(rec["by_term"])
        no_term_pool = flt(rec["no_term"])

        children = []

        # 1. Receipts tagged with a payment term: fill that term's installments by due date
        for r in rows:
            term = norm_term(r.payment_term)
            amount = flt(r.payment_amount)
            alloc = min(term_pool.get(term, 0), amount)
            term_pool[term] = term_pool.get(term, 0) - alloc
            received = max(alloc, flt(r.paid_amount))
            last_date = rec["by_term_date"].get(term) if received > 0 else None
            children.append({"row": r, "received": received, "last_date": last_date})

        # 2. Receipts without a term: fill whatever is still outstanding, oldest due date first
        for c in children:
            if no_term_pool <= 0:
                break
            gap = flt(c["row"].payment_amount) - c["received"]
            if gap > 0:
                take = min(gap, no_term_pool)
                c["received"] += take
                no_term_pool -= take
                c["last_date"] = rec["no_term_date"] or c["last_date"]

        child_rows = []
        for c in children:
            r = c["row"]
            amount = flt(r.payment_amount)
            received = min(c["received"], amount) if amount else c["received"]
            outstanding = max(amount - received, 0)
            status = row_status(amount, outstanding, received, r.due_date, today_date)
            if status_filter and status != status_filter:
                continue
            days_overdue = (
                date_diff(today_date, r.due_date)
                if (status == "Overdue" and r.due_date)
                else 0
            )
            child_rows.append({
                "name": r.schedule_name,
                "parent_so": so,
                "indent": 1,
                "payment_term": r.payment_term,
                "description": r.description,
                "due_date": r.due_date,
                "portion": flt(r.invoice_portion),
                "amount": amount,
                "received": received,
                "outstanding": outstanding,
                "last_received_date": c["last_date"],
                "days_overdue": days_overdue,
                "status": status,
            })

        if not child_rows:
            continue

        total_amount = sum(c["amount"] for c in child_rows)
        total_received = sum(c["received"] for c in child_rows)
        total_outstanding = sum(c["outstanding"] for c in child_rows)
        statuses = {c["status"] for c in child_rows}
        if statuses == {"Paid"}:
            so_status = "Paid"
        elif "Overdue" in statuses:
            so_status = "Overdue"
        elif total_received > 0:
            so_status = "Partly Paid"
        else:
            so_status = "Pending"

        unpaid_due = [c["due_date"] for c in child_rows if c["outstanding"] > 0 and c["due_date"]]
        last_dates = [c["last_received_date"] for c in child_rows if c["last_received_date"]]
        first = rows[0]

        data.append({
            "name": so,
            "parent_so": None,
            "indent": 0,
            "so_date": first.so_date,
            "customer_name": first.customer_name,
            "delivery_date": first.delivery_date,
            "order_total": flt(first.order_total),
            "due_date": min(unpaid_due) if unpaid_due else None,  # next unpaid due date
            "portion": sum(c["portion"] for c in child_rows),
            "amount": total_amount,
            "received": total_received,
            "outstanding": total_outstanding,
            "last_received_date": max(last_dates) if last_dates else None,
            "days_overdue": max((c["days_overdue"] for c in child_rows), default=0),
            "status": so_status,
        })
        data.extend(child_rows)

    return data