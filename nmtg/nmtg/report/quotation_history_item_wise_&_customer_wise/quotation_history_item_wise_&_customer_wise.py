# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import json
import ntpath
import re

import frappe
from frappe import _
from frappe.utils import flt, formatdate


def execute(filters=None):
    filters = filters or {}
    columns = get_columns(filters)
    data = get_data(filters)
    return columns, data


def get_columns(filters):
    view_by = filters.get("view_by") or "Item Wise"
    if view_by == "Customer Wise":
        return get_customer_wise_columns()
    return get_item_wise_columns()


def get_item_wise_columns():
    return [
        {"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 140},
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 120},
        {"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 200},
        {"label": _("SIZE"), "fieldname": "size", "fieldtype": "Data", "width": 130},
        {"label": _("Description"), "fieldname": "description", "fieldtype": "Data", "width": 180},
        {"label": _("Customer Item Code"), "fieldname": "customer_item_code", "fieldtype": "Data", "width": 130},
        {"label": _("Drg No"), "fieldname": "drg_no", "fieldtype": "Data", "width": 100},
        {"label": _("Qtn No."), "fieldname": "quotation_no", "fieldtype": "Link", "options": "Quotation", "width": 110},
        {"label": _("Date"), "fieldname": "transaction_date", "fieldtype": "Data", "width": 90},
        {"label": _("Quantity"), "fieldname": "qty", "fieldtype": "Float", "width": 80},
        {"label": _("Rate"), "fieldname": "rate", "fieldtype": "Currency", "width": 90},
        {"label": _("Discount"), "fieldname": "discount", "fieldtype": "Data", "width": 80},
        {"label": _("Margin %"), "fieldname": "margin_pct", "fieldtype": "Data", "width": 80},
        {"label": _("Margin Value"), "fieldname": "margin_value", "fieldtype": "Currency", "width": 100},
        {"label": _("Rate After add margin and deduction Discount"), "fieldname": "rate_after_margin_discount", "fieldtype": "Currency", "width": 180},
        {"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "width": 110},
        {"label": _("Status"), "fieldname": "qtn_status", "fieldtype": "Data", "width": 90},
    ]


def get_customer_wise_columns():
    return [
        {"label": _("Quotation No."), "fieldname": "quotation_no", "fieldtype": "Link", "options": "Quotation", "width": 110},
        {"label": _("Quotation Date"), "fieldname": "transaction_date", "fieldtype": "Data", "width": 100},
        {"label": _("Rev No"), "fieldname": "rev_no", "fieldtype": "Data", "width": 70},
        {"label": _("Rev Date"), "fieldname": "rev_date", "fieldtype": "Data", "width": 90},
        {"label": _("Enquiry No"), "fieldname": "enquiry_no", "fieldtype": "Link", "options": "Opportunity", "width": 120},
        {"label": _("Enquiry Date"), "fieldname": "enquiry_date", "fieldtype": "Data", "width": 100},
        {"label": _("Reference No"), "fieldname": "reference_no", "fieldtype": "Data", "width": 110},
        {"label": _("Kind Attn."), "fieldname": "kind_attn", "fieldtype": "Data", "width": 110},
        {"label": _("Created By"), "fieldname": "created_by", "fieldtype": "Data", "width": 110},
        {"label": _("City"), "fieldname": "city", "fieldtype": "Data", "width": 100},
        {"label": _("Status"), "fieldname": "qtn_status", "fieldtype": "Data", "width": 90},
        {"label": _("Currency"), "fieldname": "currency", "fieldtype": "Data", "width": 80},
        {"label": _("Item"), "fieldname": "item_name", "fieldtype": "Data", "width": 180},
        {"label": _("Size"), "fieldname": "size", "fieldtype": "Data", "width": 130},
        {"label": _("Drg No."), "fieldname": "drg_no", "fieldtype": "Data", "width": 100},
        {"label": _("Cust Part No."), "fieldname": "customer_item_code", "fieldtype": "Data", "width": 110},
        {"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 70},
        {"label": _("Quantity"), "fieldname": "qty", "fieldtype": "Float", "width": 80},
        {"label": _("Rate"), "fieldname": "rate", "fieldtype": "Currency", "width": 90},
        {"label": _("Margin %"), "fieldname": "margin_pct", "fieldtype": "Data", "width": 80},
        {"label": _("Discount"), "fieldname": "discount", "fieldtype": "Data", "width": 80},
        {"label": _("Margin Amount"), "fieldname": "margin_value", "fieldtype": "Currency", "width": 100},
        {"label": _("Rate After add margin and deduction Discount"), "fieldname": "rate_after_margin_discount", "fieldtype": "Currency", "width": 180},
        {"label": _("Total Amount"), "fieldname": "amount", "fieldtype": "Currency", "width": 110},
        {"label": _("Status"), "fieldname": "technical_status", "fieldtype": "Data", "width": 90},
    ]


def get_data(filters):
    conditions, values = get_conditions(filters)

    query = f"""
        SELECT
            qtn.name as quotation_no,
            qtn.transaction_date,
            qtn.customer_name,
            qtn.status as qtn_status,
            qtn.opportunity,
            qtn.currency,
            qtn.contact_display,
            qtn.owner,
            qtn.place_of_supply,
            qtn.custom_rev_no,
            qtn.custom_rev_date,
            qi.item_code,
            qi.item_name,
            qi.description,
            qi.uom,
            oi.custom_customer_material_code,
            oi.custom_technical_status as technical_status,
            qi.qty,
            qi.rate,
            qi.discount_percentage,
            qi.margin_type,
            qi.margin_rate_or_amount,
            qi.rate_with_margin,
            qi.net_rate,
            qi.net_amount,
            oi.custom_request_no as request_no,
            oi.custom_technical_evaluation as technical_evaluation,
            oi.custom_selected_model as nmtg_model,
            te.version as te_version,
            tei.required_feilds,
            att.attachments,
            opp.transaction_date as enquiry_date,
            opp.custom_customer_rfq_number as reference_no
        FROM `tabQuotation` qtn
        INNER JOIN `tabQuotation Item` qi ON qi.parent = qtn.name
        LEFT JOIN `tabOpportunity Item` oi
            ON oi.parent = qtn.opportunity AND oi.item_code = qi.item_code
        LEFT JOIN `tabOpportunity` opp ON opp.name = qtn.opportunity
        LEFT JOIN `tabTechnical Evaluation` te
            ON te.name = oi.custom_technical_evaluation
        LEFT JOIN `tabTechnical Evaluation Item` tei
            ON tei.parent = te.name AND tei.request_no = oi.custom_request_no
        LEFT JOIN (
            SELECT parent, request_no, GROUP_CONCAT(attachment SEPARATOR '||') as attachments
            FROM `tabAttachment`
            WHERE parenttype = 'Technical Evaluation'
            GROUP BY parent, request_no
        ) att ON att.parent = te.name AND att.request_no = oi.custom_request_no
        WHERE qtn.docstatus < 2
        {conditions}
        ORDER BY {get_order_by(filters)}
    """

    rows = frappe.db.sql(query, values, as_dict=1)
    return post_process(rows, filters)


def post_process(rows, filters):
    """Adds the derived margin/discount/size display fields and a per-group
    serial number that resets whenever the primary group changes."""
    view_by = filters.get("view_by") or "Item Wise"
    group_fn = (lambda r: (r.item_code, r.customer_name)) if view_by == "Item Wise" \
        else (lambda r: (r.customer_name, r.item_code))

    current_key = None
    counter = 0
    data = []

    for r in rows:
        key = group_fn(r)
        if key != current_key:
            current_key = key
            counter = 0
        counter += 1

        if view_by == "Customer Wise":
            data.append(build_customer_wise_row(r))
        else:
            data.append(build_item_wise_row(r))

    return data


def build_item_wise_row(r):
    margin_value = flt(r.rate_with_margin) - flt(r.rate)
    return {
        "customer_name": r.customer_name,
        "item_code": r.item_code,
        "item_name": r.item_name,
        "size": get_size(r.required_feilds),
        "description": strip_html(r.description),
        "customer_item_code": r.custom_customer_material_code,
        "drg_no": get_drg_no(r.attachments),
        "quotation_no": r.quotation_no,
        "transaction_date": formatdate(r.transaction_date, "dd/mm/yyyy") if r.transaction_date else "",
        "qty": r.qty,
        "rate": r.rate,
        "discount": f"{flt(r.discount_percentage)}%" if r.discount_percentage else "",
        "margin_pct": f"{flt(r.margin_rate_or_amount)}%" if r.margin_type == "Percentage" and r.margin_rate_or_amount else "",
        "margin_value": margin_value if margin_value else None,
        "rate_after_margin_discount": r.net_rate,
        "amount": r.net_amount,
        "qtn_status": r.qtn_status,
    }


def build_customer_wise_row(r):
    margin_value = flt(r.rate_with_margin) - flt(r.rate)
    return {
        "quotation_no": r.quotation_no,
        "transaction_date": formatdate(r.transaction_date, "dd/mm/yyyy") if r.transaction_date else "",
        # NOTE: no Rev No / Rev Date field exists on Quotation in the data shared so far
        # (no revision/amendment field was present) — left blank until confirmed.
        "rev_no": r.custom_rev_no,
        "rev_date": formatdate(r.custom_rev_date, "dd/mm/yyyy") if r.custom_rev_date else "",
        "enquiry_no": r.opportunity,
        "enquiry_date": formatdate(r.enquiry_date, "dd/mm/yyyy") if r.enquiry_date else "",
        "reference_no": r.reference_no,
        "kind_attn": r.contact_display,
        "created_by": r.owner,
        "city": r.place_of_supply,
        "qtn_status": r.qtn_status,
        "currency": r.currency,
        "item_name": r.item_name,
        "size": get_size(r.required_feilds),
        "drg_no": get_drg_no(r.attachments),
        "customer_item_code": r.custom_customer_material_code,
        "uom": r.uom,
        "qty": r.qty,
        "rate": r.rate,
        "margin_pct": f"{flt(r.margin_rate_or_amount)}%" if r.margin_type == "Percentage" and r.margin_rate_or_amount else "",
        "discount": f"{flt(r.discount_percentage)}%" if r.discount_percentage else "",
        "margin_value": margin_value if margin_value else None,
        "rate_after_margin_discount": r.net_rate,
        "amount": r.net_amount,
        "technical_status": r.technical_status,
    }


def get_size(required_feilds):
    """Builds a SIZE string like 'ID 50 x OD 30 x TL 30' from the
    Technical Evaluation Item's required_feilds JSON (custom_id/custom_od/custom_tl)."""
    if not required_feilds:
        return ""
    try:
        fields = json.loads(required_feilds)
    except (TypeError, ValueError):
        return ""

    parts = []
    if fields.get("custom_id") is not None:
        parts.append(f"ID {flt(fields.get('custom_id'))}")
    if fields.get("custom_od") is not None:
        parts.append(f"OD {flt(fields.get('custom_od'))}")
    if fields.get("custom_tl") is not None:
        parts.append(f"TL {flt(fields.get('custom_tl'))}")

    return " x ".join(parts)


def get_drg_no(attachments):
    """Renders the Technical Evaluation's drawing attachment file name(s)
    (from the Attachment child table) for the item's request_no."""
    if not attachments:
        return ""
    names = [ntpath.basename(path) for path in attachments.split("||") if path]
    return ", ".join(names)


def strip_html(value):
    if not value:
        return ""
    return re.sub(r"<[^>]+>", "", value).strip()


def get_conditions(filters):
    conditions = []
    values = {}

    if filters.get("company"):
        conditions.append("qtn.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("customer_name"):
        conditions.append("qtn.customer_name = %(customer_name)s")
        values["customer_name"] = filters["customer_name"]

    if filters.get("item_code"):
        conditions.append("qi.item_code = %(item_code)s")
        values["item_code"] = filters["item_code"]

    if filters.get("from_date"):
        conditions.append("qtn.transaction_date >= %(from_date)s")
        values["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("qtn.transaction_date <= %(to_date)s")
        values["to_date"] = filters["to_date"]

    return (" AND " + " AND ".join(conditions) if conditions else ""), values


def get_order_by(filters):
    view_by = filters.get("view_by") or "Item Wise"
    if view_by == "Customer Wise":
        return "qtn.customer_name, qi.item_code, qtn.transaction_date"
    return "qi.item_code, qtn.customer_name, qtn.transaction_date"