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

# Payment Request child table field holding the Before Dispatch ready qty per item
PR_ITEM_DOCTYPE = "Payment Request CT"
PR_ITEM_READY_FIELD = "before_dispatch_ready_qty"

# Payment term classification (matched against payment term name + description, lower case)
ADVANCE_KEYWORDS = ["advance"]
BEFORE_DISPATCH_KEYWORDS = ["before dispatch", "prior to dispatch", "pre dispatch", "pre-dispatch",
                            "against dispatch", "before delivery", "against pi", "proforma"]


def execute(filters=None):
    filters = filters or {}
    data = get_data(filters)
    max_entries = 0
    for row in data:
        for key in row:
            if key.startswith("bd_pr_"):
                max_entries = max(max_entries, int(key.rsplit("_", 1)[1]))
    return get_columns(max_entries), data


def get_columns(max_entries=0):
    columns = [
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

    # One Payment Request + ready qty column pair per Before Dispatch Payment Request,
    # placed right after the total "Before Dispatch Ready Qty" column.
    entry_columns = []
    for n in range(1, max_entries + 1):
        entry_columns.append({
            "label": _("Before Dispatch Payment Request {0}").format(n),
            "fieldname": "bd_pr_{0}".format(n),
            "fieldtype": "Link",
            "options": "Payment Request",
            "width": 170,
        })
        entry_columns.append({
            "label": _("Before Dispatch Ready Qty {0}").format(n),
            "fieldname": "bd_qty_{0}".format(n),
            "fieldtype": "Float",
            "width": 150,
        })
    at = [c["fieldname"] for c in columns].index("ready_qty") + 1
    return columns[:at] + entry_columns + columns[at:]


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
    """{sales_invoice: set(sales_order)} for submitted Sales Invoices linked to the given SOs."""
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


def get_payment_request_terms(pr_names):
    """{payment_request_name: normalised custom_payment_term}"""
    pr_names = [p for p in pr_names if p]
    if not pr_names or not frappe.db.has_column("Payment Request", "custom_payment_term"):
        return {}
    rows = frappe.db.sql(
        """
        SELECT name, custom_payment_term
        FROM `tabPayment Request`
        WHERE name IN %(names)s
        """,
        {"names": tuple(set(pr_names))},
        as_dict=True,
    )
    return {r.name: norm_term(r.custom_payment_term) for r in rows}


def get_received(so_names, si_to_sos):
    """
    Receipts per Sales Order, split by payment term.

    Payment Entries can be against the Sales Order, or (after the advance is pulled
    into the invoice) against a Sales Invoice of that SO. The term of each allocation
    is resolved in this order:
      1. Payment Entry Reference.payment_term
      2. Payment Entry.custom_payment_term (header)
      3. Payment Request.custom_payment_term, where the Payment Request is
         Payment Entry Reference.payment_request or, when empty, the
         Payment Entry's reference_no
    """
    if not so_names:
        return {}

    pe_term_select = "pe.custom_payment_term" if frappe.db.has_column("Payment Entry", "custom_payment_term") else "NULL"

    select_sql = """
        SELECT per.reference_name, per.payment_term, per.payment_request, per.allocated_amount,
               pe.posting_date, pe.reference_no, pe.unallocated_amount, pe.total_allocated_amount,
               {pe_term_select} AS pe_term
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

    if si_to_sos:
        for e in frappe.db.sql(select_sql, {"doctype": "Sales Invoice", "names": tuple(si_to_sos.keys())}, as_dict=True):
            sos = si_to_sos.get(e.reference_name, set())
            if len(sos) == 1:
                entries.append((next(iter(sos)), e))

    # Payment Request terms (payment_request link, else reference_no)
    candidate_prs = []
    for _so, e in entries:
        if e.payment_request:
            candidate_prs.append(e.payment_request)
        elif e.reference_no:
            candidate_prs.append(e.reference_no)
    pr_terms = get_payment_request_terms(candidate_prs)

    result = {}
    for so, e in entries:
        d = result.setdefault(so, {"by_term": {}, "by_term_date": {}, "no_term": 0, "no_term_date": None})

        amt = flt(e.allocated_amount)
        # excess of a Payment Entry stays "unallocated" - add it back pro rata
        if flt(e.unallocated_amount) > 0 and flt(e.total_allocated_amount) > 0:
            amt += flt(e.unallocated_amount) * (amt / flt(e.total_allocated_amount))

        pr_name = e.payment_request or e.reference_no
        term = norm_term(e.payment_term) or norm_term(e.pe_term) or pr_terms.get(pr_name, "")

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


def get_before_dispatch_entries(so_names, si_to_sos):
    """
    Returns {sales_order: [{"name", "request_date", "items": {item_code: ready_qty}}, ...]}
    for submitted Before Dispatch Payment Requests (raised against the Sales Order or
    against one of its Sales Invoices) that have rows in the Payment Request child table.
    Oldest request first.
    """
    if not so_names or not frappe.db.table_exists(PR_ITEM_DOCTYPE):
        return {}

    pr_rows = frappe.db.sql(
        """
        SELECT
            pr.name,
            pr.reference_doctype,
            pr.reference_name,
            pr.custom_payment_term AS payment_term,
            COALESCE(pr.transaction_date, DATE(pr.creation)) AS request_date
        FROM `tabPayment Request` pr
        WHERE pr.docstatus = 1
            AND pr.payment_request_type = 'Inward'
            AND (
                (pr.reference_doctype = 'Sales Order' AND pr.reference_name IN %(sos)s)
                OR
                (pr.reference_doctype = 'Sales Invoice' AND pr.reference_name IN %(sis)s)
            )
        """,
        {"sos": tuple(so_names), "sis": tuple(si_to_sos.keys()) or ("",)},
        as_dict=True,
    )

    pr_so = {}
    for pr in pr_rows:
        if classify(pr.payment_term, "") != "Before Dispatch":
            continue
        if pr.reference_doctype == "Sales Order":
            pr_so[pr.name] = (pr.reference_name, pr.request_date)
        else:
            sos = si_to_sos.get(pr.reference_name, set())
            if len(sos) == 1:
                pr_so[pr.name] = (next(iter(sos)), pr.request_date)

    if not pr_so:
        return {}

    item_rows = frappe.db.sql(
        """
        SELECT parent, item_code, `{field}` AS ready_qty
        FROM `tab{dt}`
        WHERE parenttype = 'Payment Request'
            AND parent IN %(prs)s
        """.format(field=PR_ITEM_READY_FIELD, dt=PR_ITEM_DOCTYPE),
        {"prs": tuple(pr_so.keys())},
        as_dict=True,
    )

    per_pr = {}
    for r in item_rows:
        if not r.item_code:
            continue
        items = per_pr.setdefault(r.parent, {})
        items[r.item_code] = items.get(r.item_code, 0) + flt(r.ready_qty)

    result = {}
    for pr_name, items in per_pr.items():
        so, request_date = pr_so[pr_name]
        result.setdefault(so, []).append({"name": pr_name, "request_date": request_date, "items": items})

    for so in result:
        result[so].sort(key=lambda e: (str(e["request_date"] or ""), e["name"]))
    return result


def get_item_taxes(so_names):
    """Returns {item_row_name: total tax amount} from Item Wise Tax Detail."""
    if not so_names:
        return {}
    rows = frappe.db.sql(
        """
        SELECT item_row, SUM(amount) AS tax
        FROM `tabItem Wise Tax Detail`
        WHERE parenttype = 'Sales Order'
            AND parent IN %(sos)s
        GROUP BY item_row
        """,
        {"sos": tuple(so_names)},
        as_dict=True,
    )
    return {r.item_row: flt(r.tax) for r in rows}


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
            so.grand_total AS so_grand_total,
            so.rounded_total AS so_rounded_total,
            so.total_taxes_and_charges AS so_taxes,
            {ld_select},
            soi.name AS so_detail,
            soi.idx,
            soi.item_code,
            soi.qty,
            soi.amount,
            soi.net_amount,
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

    si_to_sos = get_si_so_map(so_names)
    received_map = get_received(so_names, si_to_sos)
    bd_entries_map = get_before_dispatch_entries(so_names, si_to_sos)
    item_taxes = get_item_taxes(so_names)
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

        # ---- SO totals used to split the order value item-wise ----
        first = items[0]
        grand_total = flt(first.so_grand_total)
        # payment schedule is calculated on rounded_total
        so_total = flt(first.so_rounded_total) or grand_total
        rounding_diff = so_total - grand_total
        so_taxes = flt(first.so_taxes)
        so_net = sum(flt(i.net_amount or i.amount) for i in items)

        # If item wise tax rows are not available, spread the SO tax total over the
        # items by amount, so item totals always add up to the SO total.
        item_tax_found = sum(flt(item_taxes.get(i.so_detail, 0)) for i in items)
        spread_so_taxes = (not item_tax_found) and so_taxes and so_net

        # ---- Before Dispatch Payment Requests (oldest first) -> column number ----
        bd_entries = bd_entries_map.get(so, [])
        bd_entry_no = {e["name"]: n for n, e in enumerate(bd_entries, 1)}
        remaining_ready = {}
        for entry in bd_entries:
            for code, qty in entry["items"].items():
                remaining_ready.setdefault(code, []).append((entry["name"], qty))

        # ---- child (item) rows ----
        child_rows = []
        for i in items:
            d = dispatch_map.get(i.so_detail)
            item_ld = bool(cint(i.ld_flag)) if has_ld_field else False

            # item total = net amount + item tax + share of the rounding difference
            item_net = flt(i.net_amount or i.amount)
            if spread_so_taxes:
                item_tax = flt(so_taxes * item_net / so_net, 2)
            else:
                item_tax = flt(item_taxes.get(i.so_detail, 0), 2)
            item_gross = item_net + item_tax
            item_rounding = rounding_diff * item_gross / grand_total if grand_total else 0
            item_total = flt(item_gross + item_rounding, 2)

            # item amounts per payment bucket (percent applied on the item's own total)
            def bucket_amounts(b):
                amt = flt(item_total * b["pct"] / 100, 2)
                ratio = (b["received"] / b["amount"]) if b["amount"] else 0
                return amt, flt(amt * ratio, 2)

            item_adv, item_adv_rec = bucket_amounts(adv)
            item_bd, item_bd_rec = bucket_amounts(bd)
            item_ad, item_ad_rec = bucket_amounts(ad)

            item_out = {
                "Advance": max(flt(item_adv - item_adv_rec, 2), 0),
                "Before Dispatch": max(flt(item_bd - item_bd_rec, 2), 0),
                "After Delivery": max(flt(item_ad - item_ad_rec, 2), 0),
            }
            item_pending_total = sum(item_out.values())
            item_pending_types = ", ".join(k for k, v in item_out.items() if v > 0.005)

            # ready qty: from Before Dispatch Payment Requests (per item code, entries are
            # shown on the first row of the item code only); fall back to draft Delivery Notes
            item_entries = remaining_ready.pop(i.item_code, []) if bd_entries else []
            if bd_entries:
                item_ready = sum(q for _pr, q in item_entries)
            else:
                item_ready = ready_map.get(i.so_detail, 0)

            # item level remaining credit days
            item_remaining = None
            item_base = (d.grn_date if (d and item_ld) else None) if item_ld else (d.dispatch_date if d else None)
            if item_base and item_ad:
                item_due = add_days(getdate(item_base), ad["credit_days"])
                item_remaining = date_diff(item_due, today_date)

            # tree rows need a unique "name": show the item code, padded with invisible
            # zero-width spaces so the same item in two orders / twice in one order stays unique
            row_counter += 1
            row = {
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
                "so_value": item_total,
                "adv_pct": adv["pct"],
                "adv_amount": item_adv,
                "adv_received": item_adv_rec,
                "adv_date": adv["date"],
                "bd_pct": bd["pct"],
                "ready_qty": item_ready,
                "pending_qty": max(flt(i.qty) - flt(i.delivered_qty), 0),
                "bd_amount": item_bd,
                "bd_received": item_bd_rec,
                "ad_term": ", ".join(ad["terms"]),
                "credit_days": ad["credit_days"],
                "grn_date": d.grn_date if (d and item_ld) else None,
                "ad_amount": item_ad,
                "ad_received": item_ad_rec,
                "ad_remaining_days": item_remaining,
                "total_pending": item_pending_total,
                "pending_types": item_pending_types,
            }
            for pr_name, pr_qty in item_entries:
                n = bd_entry_no[pr_name]
                row["bd_pr_{0}".format(n)] = pr_name
                row["bd_qty_{0}".format(n)] = pr_qty
            child_rows.append(row)

        plan_dates = [c["delivery_plan_date"] for c in child_rows if c["delivery_plan_date"]]

        # ---- parent (Sales Order) row ----
        parent = {
            "name": so,
            "parent_so": None,
            "indent": 0,
            "customer_name": first.customer_name,
            "qty": sum(c["qty"] for c in child_rows),
            "so_date": first.so_date,
            "delivery_plan_date": min(plan_dates) if plan_dates else None,
            "dispatch_date": so_dispatch,
            "ld": "Yes" if is_ld else "No",
            "so_value": so_total,
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
        }
        for n, e in enumerate(bd_entries, 1):
            parent["bd_pr_{0}".format(n)] = e["name"]
            parent["bd_qty_{0}".format(n)] = sum(e["items"].values())

        data.append(parent)
        data.extend(child_rows)

    return data