# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import ceil, date_diff, flt, nowdate


def execute(filters=None):
    filters = filters or {}
    columns = get_columns()
    data = get_data(filters)
    return columns, data


def get_columns():
    return [
        {
            "label": _("SO Number"),
            "fieldname": "sales_order",
            "fieldtype": "Link",
            "options": "Sales Order",
            "width": 140,
        },
        {
            "label": _("Item Name"),
            "fieldname": "item_name",
            "fieldtype": "Data",
            "width": 220,
        },
        {
            "label": _("Qty"),
            "fieldname": "qty",
            "fieldtype": "Float",
            "width": 80,
        },
        {
            "label": _("Status"),
            "fieldname": "status",
            "fieldtype": "Data",
            "width": 100,
        },
        {
            "label": _("SO Delivery Date"),
            "fieldname": "so_delivery_date",
            "fieldtype": "Date",
            "width": 120,
        },
        {
            "label": _("Due In (Weeks)"),
            "fieldname": "due_in_weeks",
            "fieldtype": "Data",
            "width": 110,
        },
        {
            "label": _("Actual Dispatch Date"),
            "fieldname": "actual_dispatch_date",
            "fieldtype": "Date",
            "width": 140,
        },
        {
            "label": _("Actual Delivery Date"),
            "fieldname": "actual_delivery_date",
            "fieldtype": "Date",
            "width": 140,
        },
        {
            "label": _("Base Amt (Net Total)"),
            "fieldname": "base_amount",
            "fieldtype": "Currency",
            "width": 140,
        },
        {
            "label": _("LD %"),
            "fieldname": "ld_percentage",
            "fieldtype": "Percent",
            "width": 80,
        },
        {
            "label": _("LD Amount"),
            "fieldname": "ld_amount",
            "fieldtype": "Currency",
            "width": 120,
        },
        {
            "label": _("LD Already Deducted"),
            "fieldname": "ld_amount_deducted",
            "fieldtype": "Currency",
            "width": 150,
        },
    ]


def get_data(filters):
    conditions = get_conditions(filters)

    rows = frappe.db.sql(
        """
        SELECT
            dn.name AS delivery_note,
            dn.status AS status,
            dn.posting_date AS actual_dispatch_date,
            dn.custom_ld_percentage AS ld_percentage,
            dn.custom_frequency AS custom_frequency,
            dni.against_sales_order AS sales_order,
            dni.item_name AS item_name,
            dni.qty AS qty,
            dni.custom_delivery_date AS so_delivery_date,
            dni.custom_actual_delivery_date AS actual_delivery_date,
            dni.net_amount AS base_amount,
            dni.custom_total_ld AS ld_amount,
            so.custom_ld_so AS custom_ld_so
        FROM `tabDelivery Note Item` dni
        INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
        INNER JOIN `tabSales Order` so ON so.name = dni.against_sales_order
        WHERE dn.docstatus < 2
        AND so.custom_ld_so = 1
        {conditions}
        ORDER BY dn.posting_date DESC, dni.idx
        """.format(conditions=conditions),
        filters,
        as_dict=1,
    )

    for row in rows:
        row["due_in_weeks"] = get_due_in_weeks(row)
        row["ld_amount_deducted"] = get_ld_amount_deducted(row)

    return rows


def get_conditions(filters):
    conditions = []

    if filters.get("company"):
        conditions.append("dn.company = %(company)s")
    if filters.get("customer"):
        conditions.append("dn.customer = %(customer)s")
    if filters.get("sales_order"):
        conditions.append("dni.against_sales_order = %(sales_order)s")
    if filters.get("from_date"):
        conditions.append("dn.posting_date >= %(from_date)s")
    if filters.get("to_date"):
        conditions.append("dn.posting_date <= %(to_date)s")

    return ("AND " + " AND ".join(conditions)) if conditions else ""


def get_due_in_weeks(row):
    promised_date = row.get("so_delivery_date")
    if not promised_date:
        return ""

    actual_date = row.get("actual_delivery_date") or nowdate()
    delay_days = date_diff(promised_date, actual_date)

    if delay_days <= 0:
        return "0 week(s)"

    weeks = ceil(delay_days / 7)
    label = "{0} week(s)".format(weeks)
    if not row.get("actual_delivery_date"):
        label += " (pending)"
    return label


def get_ld_amount_deducted(row):
    if not row.get("custom_ld_so"):
        return 0

    ld_amount = flt(row.get("ld_amount"))
    return ld_amount if ld_amount else 0