# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

from collections import OrderedDict

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
            "label": _("Delivery Note"),
            "fieldname": "delivery_note",
            "fieldtype": "Link",
            "options": "Delivery Note",
            "width": 140,
        },
        {
            "label": _("Committed Delivery Date"),
            "fieldname": "committed_delivery_date",
            "fieldtype": "Date",
            "width": 150,
        },
        {
            "label": _("Production Delivery Date"),
            "fieldname": "production_delivery_date",
            "fieldtype": "Date",
            "width": 160,
        },
        {
            "label": _("NMTG Dispatch Date"),
            "fieldname": "nmtg_dispatch_date",
            "fieldtype": "Date",
            "width": 150,
        },
        {
            "label": _("Material Received Date"),
            "fieldname": "material_received_date",
            "fieldtype": "Date",
            "width": 160,
        },
        {
            "label": _("Status"),
            "fieldname": "due_in_weeks",
            "fieldtype": "Data",
            "width": 110,
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

    item_rows = frappe.db.sql(
        """
        SELECT
            dn.name AS delivery_note,
            dn.posting_date AS nmtg_dispatch_date,
            dn.custom_ld_percentage AS ld_percentage,
            dn.custom_frequency AS custom_frequency,
            dni.against_sales_order AS sales_order,
            dni.item_name AS item_name,
            dni.qty AS qty,
            dni.custom_delivery_date AS material_received_date,
            dni.net_amount AS base_amount,
            dni.custom_total_ld AS ld_amount,
            soi.custom_actual_delivery_date AS committed_delivery_date,
            soi.delivery_date AS production_delivery_date,
            so.custom_ld_so AS custom_ld_so
        FROM `tabDelivery Note Item` dni
        INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
        INNER JOIN `tabSales Order` so ON so.name = dni.against_sales_order
        LEFT JOIN `tabSales Order Item` soi ON soi.name = dni.so_detail
        WHERE dn.docstatus < 2
        AND so.custom_ld_so = 1
        {conditions}
        ORDER BY dni.against_sales_order, dn.posting_date DESC, dni.idx
        """.format(conditions=conditions),
        filters,
        as_dict=1,
    )

    grouped = OrderedDict()
    for row in item_rows:
        row["due_in_weeks"] = get_due_in_weeks(row)
        row["ld_amount_deducted"] = get_ld_amount_deducted(row)
        grouped.setdefault(row["sales_order"], []).append(row)

    data = []
    for sales_order, items in grouped.items():
        # Parent row: the Sales Order itself (other fields left blank, not 0)
        data.append({
            "sales_order": sales_order,
            "item_name": "",
            "qty": "",
            "delivery_note": "",
            "committed_delivery_date": "",
            "production_delivery_date": "",
            "nmtg_dispatch_date": "",
            "material_received_date": "",
            "due_in_weeks": "",
            "base_amount": "",
            "ld_percentage": "",
            "ld_amount": "",
            "ld_amount_deducted": "",
            "indent": 0,
        })
        # Child rows: each item indented under its Sales Order
        for item in items:
            item["indent"] = 1
            item["sales_order"] = None
            data.append(item)

    return data


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


# def get_due_in_weeks(row):
#     promised_date = row.get("committed_delivery_date")
#     if not promised_date:
#         return ""

#     actual_date = row.get("material_received_date") or nowdate()
#     delay_days = date_diff(promised_date, actual_date)

#     if delay_days <= 0:
#         return "0 week(s)"

#     weeks = ceil(delay_days / 7)
#     label = "{0} week(s)".format(weeks)
#     if not row.get("material_received_date"):
#         label += " (pending)"
#     return label

def get_due_in_weeks(row):
    promised_date = row.get("committed_delivery_date")
    if not promised_date:
        return ""

    received_date = row.get("material_received_date")

    if received_date:
        delay_days = date_diff(received_date, promised_date)
        if delay_days > 0:
            return "Overdue by {0}".format(format_duration(delay_days))
        return "On time"

    delay_days = date_diff(nowdate(), promised_date)
    if delay_days > 0:
        return "Overdue by {0} (pending)".format(format_duration(delay_days))

    remaining_days = date_diff(promised_date, nowdate())
    if remaining_days == 0:
        return "Due today"
    return "Due in {0}".format(format_duration(remaining_days))


def format_duration(days):
    days = abs(days)
    if days < 7:
        return "{0} day{1}".format(days, "" if days == 1 else "s")
    weeks = ceil(days / 7)
    return "{0} week{1}".format(weeks, "" if weeks == 1 else "s")

def get_ld_amount_deducted(row):
    if not row.get("custom_ld_so"):
        return 0

    ld_amount = flt(row.get("ld_amount"))
    return ld_amount if ld_amount else 0