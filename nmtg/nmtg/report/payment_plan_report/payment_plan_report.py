import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
    filters = filters or {}
    return get_columns(), get_data(filters)


def get_columns():
    return [
        {"label": _("Purchase Order / Item"), "fieldname": "name", "fieldtype": "Data", "width": 220},
        {"label": _("PO Date"), "fieldname": "po_date", "fieldtype": "Date", "width": 110},
        {"label": _("Vendor Name"), "fieldname": "supplier_name", "fieldtype": "Data", "width": 200},
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 130},
        {"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
        {"label": _("Delivery Date"), "fieldname": "required_by", "fieldtype": "Date", "width": 110},
        {"label": _("Dispatch Date"), "fieldname": "dispatch_date", "fieldtype": "Date", "width": 110},
        {"label": _("Rate"), "fieldname": "rate", "fieldtype": "Currency", "width": 110},
        {"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 90},
        {"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "width": 130},
        {"label": _("Taxes"), "fieldname": "taxes", "fieldtype": "Currency", "width": 120},
        {"label": _("Total Amount"), "fieldname": "total_amount", "fieldtype": "Currency", "width": 130},
        {"label": _("Advance %"), "fieldname": "advance_percent", "fieldtype": "Percent", "width": 100},
        {"label": _("Advance Amount"), "fieldname": "advance_amount", "fieldtype": "Currency", "width": 130},
        {"label": _("Advance Paid Value"), "fieldname": "advance_paid", "fieldtype": "Currency", "width": 140},
    ]


def get_advance_details(po_names):
    """
    Returns {po_name: {"percent": x, "amount": y, "paid": z}}

    Advance = Payment Schedule rows whose payment term contains "Advance".
    Paid    = Payment Request (submitted, status Paid) amounts linked to those
              schedule rows, or the schedule's paid_amount if that is higher.
    """
    if not po_names:
        return {}

    schedule_rows = frappe.db.sql(
        """
        SELECT
            ps.name AS schedule_name,
            ps.parent AS purchase_order,
            ps.invoice_portion,
            ps.payment_amount,
            ps.paid_amount
        FROM `tabPayment Schedule` ps
        WHERE ps.parenttype = 'Purchase Order'
            AND ps.parent IN %(pos)s
            AND ps.payment_term LIKE %(term)s
        """,
        {"pos": tuple(po_names), "term": "%Advance%"},
        as_dict=True,
    )

    if not schedule_rows:
        return {}

    paid_by_schedule = {}
    paid_rows = frappe.db.sql(
        """
        SELECT pref.payment_schedule, SUM(pref.amount) AS paid
        FROM `tabPayment Reference` pref
        INNER JOIN `tabPayment Request` pr ON pr.name = pref.parent
        WHERE pr.docstatus = 1
            AND pr.status = 'Paid'
            AND pref.payment_schedule IN %(schedules)s
        GROUP BY pref.payment_schedule
        """,
        {"schedules": tuple(r.schedule_name for r in schedule_rows)},
        as_dict=True,
    )
    for p in paid_rows:
        paid_by_schedule[p.payment_schedule] = flt(p.paid)

    details = {}
    for r in schedule_rows:
        d = details.setdefault(r.purchase_order, {"percent": 0, "amount": 0, "paid": 0})
        d["percent"] += flt(r.invoice_portion)
        d["amount"] += flt(r.payment_amount)
        d["paid"] += max(paid_by_schedule.get(r.schedule_name, 0), flt(r.paid_amount))

    return details


def get_item_taxes(po_names):
    """Returns {item_row_name: total tax amount} from Item Wise Tax Detail."""
    if not po_names:
        return {}

    rows = frappe.db.sql(
        """
        SELECT item_row, SUM(amount) AS tax
        FROM `tabItem Wise Tax Detail`
        WHERE parenttype = 'Purchase Order'
            AND parent IN %(pos)s
        GROUP BY item_row
        """,
        {"pos": tuple(po_names)},
        as_dict=True,
    )
    return {r.item_row: flt(r.tax) for r in rows}


def get_data(filters):
    conditions = ["po.docstatus = 1"]
    values = {}

    if filters.get("company"):
        conditions.append("po.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("supplier"):
        conditions.append("po.supplier = %(supplier)s")
        values["supplier"] = filters["supplier"]

    if filters.get("purchase_order"):
        conditions.append("po.name = %(purchase_order)s")
        values["purchase_order"] = filters["purchase_order"]

    if filters.get("item_code"):
        conditions.append("poi.item_code = %(item_code)s")
        values["item_code"] = filters["item_code"]

    if filters.get("from_date"):
        conditions.append("poi.schedule_date >= %(from_date)s")
        values["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("poi.schedule_date <= %(to_date)s")
        values["to_date"] = filters["to_date"]

    rows = frappe.db.sql(
        """
        SELECT
            po.name AS purchase_order,
            po.supplier_name AS supplier_name,
            po.transaction_date AS po_date,
            po.schedule_date AS po_schedule_date,
            po.grand_total AS po_grand_total,
            po.rounded_total AS po_rounded_total,
            po.total_taxes_and_charges AS po_taxes,
            poi.item_code AS item_code,
            poi.item_name AS item_name,
            poi.schedule_date AS item_schedule_date,
            poi.expected_delivery_date AS dispatch_date,
            poi.rate AS rate,
            poi.qty AS qty,
            poi.amount AS amount
        FROM `tabPurchase Order` po
        INNER JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
        WHERE {conditions}
        ORDER BY po.transaction_date DESC, po.name, poi.idx
        """.format(conditions=" AND ".join(conditions)),
        values,
        as_dict=True,
    )

    # Group items under their Purchase Order
    grouped = {}
    for r in rows:
        grouped.setdefault(r.purchase_order, []).append(r)

    po_list = list(grouped.keys())
    advances = get_advance_details(po_list)
    item_taxes = get_item_taxes(po_list)

    data = []
    for po, items in grouped.items():
        po_amount = sum(flt(i.amount) for i in items)
        po_qty = sum(flt(i.qty) for i in items)
        adv = advances.get(po, {})

        grand_total = flt(items[0].po_grand_total)
        # payment schedule is calculated on rounded_total
        po_total = flt(items[0].po_rounded_total) or grand_total
        rounding_diff = po_total - grand_total

        # Parent row (Purchase Order)
        data.append({
            "name": po,
            "parent_po": None,
            "indent": 0,
            "po_date": items[0].po_date,
            "supplier_name": items[0].supplier_name,
            "required_by": items[0].po_schedule_date,
            "qty": po_qty,
            "amount": po_amount,
            "taxes": flt(items[0].po_taxes),
            "total_amount": po_total,
            "advance_percent": adv.get("percent"),
            "advance_amount": adv.get("amount"),
            "advance_paid": adv.get("paid"),
        })

        # Child rows (Items) - advance % applied on the item's own total amount
        adv_percent = flt(adv.get("percent", 0))
        # fraction of the advance that has actually been paid (0 to 1)
        paid_ratio = (
            flt(adv.get("paid", 0)) / flt(adv.get("amount", 0))
            if adv and flt(adv.get("amount", 0))
            else 0
        )

        for i in items:
            item_tax = flt(item_taxes.get(i.row_name, 0), 2)
            item_gross = flt(i.amount) + item_tax

            # spread the rounding difference so item totals add up to rounded_total
            item_rounding = (
                rounding_diff * item_gross / grand_total if grand_total else 0
            )
            item_total = flt(item_gross + item_rounding, 2)

            item_advance = flt(item_total * adv_percent / 100, 2)

            data.append({
                "name": i.row_name,
                "parent_po": po,
                "indent": 1,
                "item_code": i.item_code,
                "item_name": i.item_name,
                "required_by": i.item_schedule_date,
                "dispatch_date": i.dispatch_date,
                "rate": i.rate,
                "qty": i.qty,
                "amount": i.amount,
                "taxes": item_tax,
                "total_amount": item_total,
                "advance_percent": adv.get("percent") if adv else None,
                "advance_amount": item_advance if adv else None,
                "advance_paid": flt(item_advance * paid_ratio, 2) if adv else None,
            })

    return data