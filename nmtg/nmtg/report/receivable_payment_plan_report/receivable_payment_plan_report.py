# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, cint, getdate, today, date_diff, add_days

# ---------------------------------------------------------------------------
# CONFIG - adjust to your site's custom fields / payment term naming
# ---------------------------------------------------------------------------
# First existing field found is used for the "LD?" flag (checked on Sales Order, then Sales Order Item)
LD_FIELD_CANDIDATES = ["custom_ld_so"]

# Delivery Note Item field holding the customer side GRN / material received date
GRN_DATE_FIELD = "custom_delivery_date"

# Payment term classification (matched against payment term name + description, lower case)
ADVANCE_KEYWORDS = ["advance"]
BEFORE_DISPATCH_KEYWORDS = ["before dispatch", "prior to dispatch", "pre dispatch", "pre-dispatch",
                            "against dispatch", "before delivery", "against pi", "proforma"]


def execute(filters=None):
    filters = filters or {}
    return get_columns(), get_data(filters)


def get_columns():
    return [
        {"label": _("Sales Order / Item"), "fieldname": "name", "fieldtype": "Data", "width": 200},
        {"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 200},
        {"label": _("Item"), "fieldname": "item_code", "fieldtype": "Data", "width": 160},
        {"label": _("Required Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 100},
        {"label": _("SO Date"), "fieldname": "so_date", "fieldtype": "Date", "width": 100},
        {"label": _("Delivery Plan Date"), "fieldname": "delivery_plan_date", "fieldtype": "Date", "width": 120},
        {"label": _("Dispatch Date"), "fieldname": "dispatch_date", "fieldtype": "Date", "width": 110},
        {"label": _("LD?"), "fieldname": "ld", "fieldtype": "Data", "width": 60},
        {"label": _("SO Value"), "fieldname": "so_value", "fieldtype": "Currency", "width": 120},

        {"label": _("Advance %"), "fieldname": "adv_pct", "fieldtype": "Percent", "width": 90},
        {"label": _("Advance Amount"), "fieldname": "adv_amount", "fieldtype": "Currency", "width": 120},
        {"label": _("Advance Received Value"), "fieldname": "adv_received", "fieldtype": "Currency", "width": 130},
        {"label": _("Advance Receive Date"), "fieldname": "adv_date", "fieldtype": "Date", "width": 120},

        {"label": _("Before Dispatch %"), "fieldname": "bd_pct", "fieldtype": "Percent", "width": 110},
        {"label": _("Before Dispatch Ready Qty"), "fieldname": "ready_qty", "fieldtype": "Float", "width": 130},
        {"label": _("Pending Qty"), "fieldname": "pending_qty", "fieldtype": "Float", "width": 100},
        {"label": _("Before Dispatch Amount"), "fieldname": "bd_amount", "fieldtype": "Currency", "width": 130},
        {"label": _("Received Before Dispatch Amount"), "fieldname": "bd_received", "fieldtype": "Currency", "width": 150},

        {"label": _("After Delivery Payment Term"), "fieldname": "ad_term", "fieldtype": "Data", "width": 180},
        {"label": _("Credit Days"), "fieldname": "credit_days", "fieldtype": "Int", "width": 90},
        {"label": _("Customer Side GRN Date (LD Order)"), "fieldname": "grn_date", "fieldtype": "Date", "width": 150},
        {"label": _("After Delivery Payment Value"), "fieldname": "ad_amount", "fieldtype": "Currency", "width": 140},
        {"label": _("After Delivery Received Amount"), "fieldname": "ad_received", "fieldtype": "Currency", "width": 150},
        {"label": _("After Delivery Remaining Credit Days"), "fieldname": "ad_remaining_days", "fieldtype": "Int", "width": 150},

        {"label": _("Total Pending Amount"), "fieldname": "total_pending", "fieldtype": "Currency", "width": 140},
        {"label": _("Pending Payment Type(s)"), "fieldname": "pending_types", "fieldtype": "Data", "width": 220},
    ]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def norm_term(value):
    return " ".join((value or "").split())


def classify(term, description):
    text = (norm_term(term) + " " + norm_term(description)).lower()
    if any(k in text for k in ADVANCE_KEYWORDS):
        return "Advance"
    if any(k in text for k in BEFORE_DISPATCH_KEYWORDS):
        return "Before Dispatch"
    return "After Delivery"


def first_existing_column(doctype, candidates):
    for c in candidates:
        if frappe.db.has_column(doctype, c):
            return c
    return None


def get_si_so_map(so_names):
    if not so_names:
        return {}
    rows = frappe.db.sql(
        """
        SELECT DISTINCT sii.parent AS sales_invoice, sii.sales_order
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.docstatus = 1 AND sii.sales_order IN %(sos)s
        """,
        {"sos": tuple(so_names)},
        as_dict=True,
    )
    result = {}
    for r in rows:
        result.setdefault(r.sales_invoice, set()).add(r.sales_order)
    return result


def get_received(so_names):
    """Receipts per Sales Order, split by payment term (same logic as the Payment Schedule report)."""
    if not so_names:
        return {}

    pe_term_select = "pe.custom_payment_term" if frappe.db.has_column("Payment Entry", "custom_payment_term") else "NULL"

    select_sql = """
        SELECT per.reference_name, per.payment_term, per.allocated_amount,
               pe.posting_date, {pe_term_select} AS pe_term
        FROM `tabPayment Entry Reference` per
        INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
        WHERE pe.docstatus = 1
            AND pe.payment_type = 'Receive'
            AND per.reference_doctype = %(doctype)s
            AND per.reference_name IN %(names)s
    """.format(pe_term_select=pe_term_select)

    entries = []
    for e in frappe.db.sql(select_sql, {"doctype": "Sales Order", "names": tuple(so_names)}, as_dict=True):
        entries.append((e.reference_name, e))

    si_to_sos = get_si_so_map(so_names)
    if si_to_sos:
        for e in frappe.db.sql(select_sql, {"doctype": "Sales Invoice", "names": tuple(si_to_sos.keys())}, as_dict=True):
            sos = si_to_sos.get(e.reference_name, set())
            if len(sos) == 1:
                entries.append((next(iter(sos)), e))

    result = {}
    for so, e in entries:
        d = result.setdefault(so, {"by_term": {}, "by_term_date": {}, "no_term": 0, "no_term_date": None})
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


def allocate_schedule(rows, rec):
    """Return [{row, received, last_date, category}] for the payment schedule rows of one SO."""
    term_pool = dict(rec["by_term"])
    no_term_pool = flt(rec["no_term"])
    out = []

    for r in rows:
        term = norm_term(r.payment_term)
        amount = flt(r.payment_amount)
        alloc = min(term_pool.get(term, 0), amount)
        term_pool[term] = term_pool.get(term, 0) - alloc
        received = max(alloc, flt(r.paid_amount))
        last_date = rec["by_term_date"].get(term) if received > 0 else None
        out.append({"row": r, "received": received, "last_date": last_date,
                    "category": classify(r.payment_term, r.description)})

    for c in out:
        if no_term_pool <= 0:
            break
        gap = flt(c["row"].payment_amount) - c["received"]
        if gap > 0:
            take = min(gap, no_term_pool)
            c["received"] += take
            no_term_pool -= take
            c["last_date"] = rec["no_term_date"] or c["last_date"]

    for c in out:
        amount = flt(c["row"].payment_amount)
        if amount:
            c["received"] = min(c["received"], amount)
    return out


def get_dispatch_info(item_rows):
    """Per Sales Order Item: latest dispatch date, latest GRN date, ready qty (draft Delivery Notes)."""
    names = [r.so_detail for r in item_rows]
    if not names:
        return {}, {}

    grn_select = "NULL"
    if frappe.db.has_column("Delivery Note Item", GRN_DATE_FIELD):
        grn_select = "MAX(dni.`{0}`)".format(GRN_DATE_FIELD)

    submitted = frappe.db.sql(
        """
        SELECT dni.so_detail, MAX(dn.posting_date) AS dispatch_date, {grn} AS grn_date
        FROM `tabDelivery Note Item` dni
        INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
        WHERE dn.docstatus = 1 AND dn.is_return = 0 AND dni.so_detail IN %(names)s
        GROUP BY dni.so_detail
        """.format(grn=grn_select),
        {"names": tuple(names)},
        as_dict=True,
    )
    dispatch = {r.so_detail: r for r in submitted}

    drafts = frappe.db.sql(
        """
        SELECT dni.so_detail, SUM(dni.qty) AS ready_qty
        FROM `tabDelivery Note Item` dni
        INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
        WHERE dn.docstatus = 0 AND dni.so_detail IN %(names)s
        GROUP BY dni.so_detail
        """,
        {"names": tuple(names)},
        as_dict=True,
    )
    ready = {r.so_detail: flt(r.ready_qty) for r in drafts}
    return dispatch, ready


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
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

    ld_so_col = first_existing_column("Sales Order", LD_FIELD_CANDIDATES)
    ld_soi_col = first_existing_column("Sales Order Item", LD_FIELD_CANDIDATES)
    ld_select = "so.`{0}` AS ld_flag".format(ld_so_col) if ld_so_col else (
        "soi.`{0}` AS ld_flag".format(ld_soi_col) if ld_soi_col else "NULL AS ld_flag")

    item_rows = frappe.db.sql(
        """
        SELECT
            so.name AS sales_order,
            so.transaction_date AS so_date,
            so.customer_name,
            COALESCE(NULLIF(so.rounded_total, 0), so.grand_total) AS so_value,
            {ld_select},
            soi.name AS so_detail,
            soi.idx,
            soi.item_code,
            soi.qty,
            soi.delivered_qty,
            COALESCE(soi.delivery_date, so.delivery_date) AS delivery_plan_date
        FROM `tabSales Order` so
        INNER JOIN `tabSales Order Item` soi ON soi.parent = so.name
        WHERE {conditions}
        ORDER BY so.transaction_date DESC, so.name, soi.idx
        """.format(ld_select=ld_select, conditions=" AND ".join(conditions)),
        values,
        as_dict=True,
    )
    if not item_rows:
        return []

    so_names = list({r.sales_order for r in item_rows})

    schedule_rows = frappe.db.sql(
        """
        SELECT ps.parent AS sales_order, ps.payment_term, ps.description, ps.due_date,
               ps.invoice_portion, ps.payment_amount, ps.paid_amount, ps.credit_days
        FROM `tabPayment Schedule` ps
        WHERE ps.parenttype = 'Sales Order' AND ps.parent IN %(sos)s
        ORDER BY ps.parent, ps.due_date, ps.idx
        """,
        {"sos": tuple(so_names)},
        as_dict=True,
    )
    schedule_by_so = {}
    for r in schedule_rows:
        schedule_by_so.setdefault(r.sales_order, []).append(r)

    received_map = get_received(so_names)
    dispatch_map, ready_map = get_dispatch_info(item_rows)
    today_date = getdate(today())
    empty_rec = {"by_term": {}, "by_term_date": {}, "no_term": 0, "no_term_date": None}

    items_by_so = {}
    for r in item_rows:
        items_by_so.setdefault(r.sales_order, []).append(r)

    data = []
    row_counter = 0
    for so, items in items_by_so.items():
        # ---- SO level payment buckets ----
        buckets = {
            "Advance": {"pct": 0, "amount": 0, "received": 0, "date": None, "terms": [], "credit_days": 0},
            "Before Dispatch": {"pct": 0, "amount": 0, "received": 0, "date": None, "terms": [], "credit_days": 0},
            "After Delivery": {"pct": 0, "amount": 0, "received": 0, "date": None, "terms": [], "credit_days": 0},
        }
        sched = allocate_schedule(schedule_by_so.get(so, []), received_map.get(so, empty_rec))
        for c in sched:
            b = buckets[c["category"]]
            b["pct"] += flt(c["row"].invoice_portion)
            b["amount"] += flt(c["row"].payment_amount)
            b["received"] += c["received"]
            if c["last_date"] and (not b["date"] or c["last_date"] > b["date"]):
                b["date"] = c["last_date"]
            term = norm_term(c["row"].payment_term)
            if term and term not in b["terms"]:
                b["terms"].append(term)
            b["credit_days"] = max(b["credit_days"], int(c["row"].credit_days or 0))

        adv, bd, ad = buckets["Advance"], buckets["Before Dispatch"], buckets["After Delivery"]

        # ---- SO level LD / dates ----
        has_ld_field = bool(ld_so_col or ld_soi_col)
        is_ld = any(cint(i.ld_flag) for i in items) if has_ld_field else False
        if filters.get("ld") == "Yes" and not is_ld:
            continue
        if filters.get("ld") == "No" and is_ld:
            continue

        dispatch_dates = [dispatch_map[i.so_detail].dispatch_date for i in items
                          if i.so_detail in dispatch_map and dispatch_map[i.so_detail].dispatch_date]
        grn_dates = [dispatch_map[i.so_detail].grn_date for i in items
                     if i.so_detail in dispatch_map and dispatch_map[i.so_detail].grn_date]
        so_dispatch = max(dispatch_dates) if dispatch_dates else None
        so_grn = max(grn_dates) if grn_dates else None

        # ---- After delivery remaining credit days (negative => overdue) ----
        remaining_days = None
        base_date = so_grn if is_ld else so_dispatch
        if base_date and ad["amount"]:
            due = add_days(getdate(base_date), ad["credit_days"])
            remaining_days = date_diff(due, today_date)

        outstanding = {
            "Advance": max(adv["amount"] - adv["received"], 0),
            "Before Dispatch": max(bd["amount"] - bd["received"], 0),
            "After Delivery": max(ad["amount"] - ad["received"], 0),
        }
        total_pending = sum(outstanding.values())
        pending_types = ", ".join(k for k, v in outstanding.items() if v > 0.005)

        if filters.get("pending_only") and total_pending <= 0.005:
            continue

        # ---- child (item) rows ----
        child_rows = []
        for i in items:
            d = dispatch_map.get(i.so_detail)
            item_ld = bool(cint(i.ld_flag)) if has_ld_field else False
            # tree rows need a unique "name": show the item code, padded with invisible
            # zero-width spaces so the same item in two orders / twice in one order stays unique
            row_counter += 1
            child_rows.append({
                "name": (i.item_code or "") + "\u200b" * row_counter,
                "parent_so": so,
                "indent": 1,
                "customer_name": i.customer_name,
                "item_code": i.item_code,
                "qty": flt(i.qty),
                "so_date": i.so_date,
                "delivery_plan_date": i.delivery_plan_date,
                "dispatch_date": d.dispatch_date if d else None,
                "ld": "Yes" if item_ld else "No",
                "ready_qty": ready_map.get(i.so_detail, 0),
                "pending_qty": max(flt(i.qty) - flt(i.delivered_qty), 0),
                "grn_date": d.grn_date if (d and item_ld) else None,
            })

        plan_dates = [c["delivery_plan_date"] for c in child_rows if c["delivery_plan_date"]]
        first = items[0]

        # ---- parent (Sales Order) row ----
        data.append({
            "name": so,
            "parent_so": None,
            "indent": 0,
            "customer_name": first.customer_name,
            "qty": sum(c["qty"] for c in child_rows),
            "so_date": first.so_date,
            "delivery_plan_date": min(plan_dates) if plan_dates else None,
            "dispatch_date": so_dispatch,
            "ld": "Yes" if is_ld else "No",
            "so_value": flt(first.so_value),
            "adv_pct": adv["pct"],
            "adv_amount": adv["amount"],
            "adv_received": adv["received"],
            "adv_date": adv["date"],
            "bd_pct": bd["pct"],
            "ready_qty": sum(c["ready_qty"] for c in child_rows),
            "pending_qty": sum(c["pending_qty"] for c in child_rows),
            "bd_amount": bd["amount"],
            "bd_received": bd["received"],
            "ad_term": ", ".join(ad["terms"]),
            "credit_days": ad["credit_days"],
            "grn_date": so_grn if is_ld else None,
            "ad_amount": ad["amount"],
            "ad_received": ad["received"],
            "ad_remaining_days": remaining_days,
            "total_pending": total_pending,
            "pending_types": pending_types,
        })
        data.extend(child_rows)

    return data