import html
import re

import frappe
from frappe import _
from frappe.utils import flt, strip_html


def execute(filters=None):
    filters = frappe._dict(filters or {})
    return get_columns(), get_data(filters)


def html_to_lines(value):
    """Convert an HTML description to plain text, keeping each line break."""
    value = value or ""
    value = re.sub(r"(?i)<br\s*/?>", "\n", value)
    value = re.sub(r"(?i)</(p|div|tr|li|h[1-6])>", "\n", value)
    value = re.sub(r"(?i)</t[dh]>", " ", value)
    value = html.unescape(strip_html(value)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def get_columns():
    return [
        {"label": _("Item Details"), "fieldname": "item_details", "fieldtype": "Data", "width": 380},
        {"label": _("Quotation No"), "fieldname": "quotation", "fieldtype": "Link", "options": "Quotation", "width": 150},
        {"label": _("Quotation Date"), "fieldname": "transaction_date", "fieldtype": "Date", "width": 110},
        {"label": _("Party Name"), "fieldname": "party_name", "fieldtype": "Data", "width": 200},
        {"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 80},
        {"label": _("Rate"), "fieldname": "price_list_rate", "fieldtype": "Currency", "options": "currency", "width": 110},
        {"label": _("Discount %"), "fieldname": "discount_percentage", "fieldtype": "Percent", "width": 90},
        {"label": _("Discount Amount"), "fieldname": "discount_amount", "fieldtype": "Currency", "options": "currency", "width": 120},
        {"label": _("Margin %"), "fieldname": "margin_percent", "fieldtype": "Percent", "width": 90},
        {"label": _("Margin Amount"), "fieldname": "margin_amount", "fieldtype": "Currency", "options": "currency", "width": 120},
        {"label": _("Rate After Margin & Discount"), "fieldname": "rate", "fieldtype": "Currency", "options": "currency", "width": 170},
        {"label": _("Total Amount"), "fieldname": "amount", "fieldtype": "Currency", "options": "currency", "width": 130},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 100},
        {"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link", "options": "Currency", "hidden": 1, "width": 80},
    ]


def get_data(filters):
    conditions = ["q.docstatus < 2"]
    values = {}

    item_codes = filters.get("item_code")
    if item_codes:
        # MultiSelectList sends a list (or a JSON / comma separated string)
        if isinstance(item_codes, str):
            try:
                item_codes = frappe.parse_json(item_codes)
            except Exception:
                item_codes = [i.strip() for i in item_codes.split(",") if i.strip()]
        if isinstance(item_codes, str):
            item_codes = [item_codes]
        item_codes = [i.get("value") if isinstance(i, dict) else i for i in item_codes]
        if item_codes:
            conditions.append("qi.item_code IN %(item_codes)s")
            values["item_codes"] = tuple(item_codes)
    if filters.get("customer"):
        conditions.append("q.party_name = %(customer)s")
        values["customer"] = filters.customer
    if filters.get("status"):
        conditions.append("q.status = %(status)s")
        values["status"] = filters.status
    if filters.get("from_date"):
        conditions.append("q.transaction_date >= %(from_date)s")
        values["from_date"] = filters.from_date
    if filters.get("to_date"):
        conditions.append("q.transaction_date <= %(to_date)s")
        values["to_date"] = filters.to_date

    rows = frappe.db.sql(
        """
        SELECT
            q.name AS quotation,
            q.transaction_date,
            q.customer_name AS party_name,
            q.status,
            q.currency,
            qi.item_code,
            qi.item_name,
            qi.description,
            qi.custom_customer_code,
            i.custom_size,
            i.custom_drg_no,
            i.description AS item_description,
            (
                SELECT GROUP_CONCAT(DISTINCT icd.ref_code SEPARATOR ', ')
                FROM `tabItem Customer Detail` icd
                WHERE icd.parent = qi.item_code
                    AND icd.parenttype = 'Item'
                    AND icd.customer_name = q.party_name
            ) AS customer_item_code,
            qi.qty,
            qi.price_list_rate,
            qi.discount_percentage,
            qi.discount_amount,
            qi.margin_type,
            qi.margin_rate_or_amount,
            qi.rate_with_margin,
            qi.rate,
            qi.amount
        FROM `tabQuotation` q
        INNER JOIN `tabQuotation Item` qi ON qi.parent = q.name
        LEFT JOIN `tabItem` i ON i.name = qi.item_code
        WHERE {conditions}
        ORDER BY qi.item_code, q.transaction_date DESC, q.name DESC
        """.format(conditions=" AND ".join(conditions)),
        values,
        as_dict=True,
    )

    data = []
    for r in rows:
        price_list_rate = flt(r.price_list_rate)
        rate_with_margin = flt(r.rate_with_margin) or price_list_rate

        margin_amount = rate_with_margin - price_list_rate
        if r.margin_type == "Percentage":
            margin_percent = flt(r.margin_rate_or_amount)
        else:
            margin_percent = (margin_amount / price_list_rate * 100) if price_list_rate else 0

        # Discount may be entered as % or as an amount: derive whichever is missing.
        # Discount is applied on the rate after margin.
        discount_amount = flt(r.discount_amount)
        discount_percentage = flt(r.discount_percentage)
        if not discount_amount and discount_percentage:
            discount_amount = rate_with_margin * discount_percentage / 100
        elif discount_amount and not discount_percentage and rate_with_margin:
            discount_percentage = discount_amount / rate_with_margin * 100

        # Item Details:
        #   CODE - NAME
        #   SIZE: ...
        #   Description: ... (quotation line description, else the Item master description)
        #   Customer Item Code: ...
        #   Drg No.: ...
        item_name = (r.item_name or "").strip()
        lines = ["{0} - {1}".format(r.item_code, item_name)]

        size = (r.custom_size or "").strip()
        if size:
            lines.append("SIZE: " + size)

        description = html_to_lines(r.description) or html_to_lines(r.item_description)
        # Item description defaults to the item name - don't repeat it
        if description and description.strip().lower() not in (item_name.lower(), (r.item_code or "").lower()):
            desc_lines = description.split("\n")
            lines.append("Description: " + desc_lines[0])
            lines.extend(desc_lines[1:])

        customer_item_code = (r.custom_customer_code or "").strip() or (r.customer_item_code or "").strip()
        if customer_item_code:
            lines.append("Customer Item Code: " + customer_item_code)

        drg_no = (r.custom_drg_no or "").strip()
        if drg_no:
            lines.append("Drg No.: " + drg_no)

        item_details = "\n".join(lines)

        data.append({
            "item_details": item_details,
            "quotation": r.quotation,
            "transaction_date": r.transaction_date,
            "party_name": r.party_name,
            "qty": flt(r.qty),
            "price_list_rate": price_list_rate,
            "discount_percentage": flt(discount_percentage, 2),
            "discount_amount": flt(discount_amount, 2),
            "margin_percent": flt(margin_percent, 2),
            "margin_amount": flt(margin_amount, 2),
            "rate": flt(r.rate),
            "amount": flt(r.amount),
            "status": r.status,
            "currency": r.currency,
        })

    return data