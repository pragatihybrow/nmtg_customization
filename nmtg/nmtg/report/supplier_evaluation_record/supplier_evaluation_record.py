# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import flt


# --------------------------------------------------------------------------
# COLUMNS
# --------------------------------------------------------------------------

def get_columns():
    return [
        {
            "fieldname": "sr_no",
            "label": _("Sr. No."),
            "fieldtype": "Int",
            "width": 70,
        },
        {
            "fieldname": "item_name",
            "label": _("Name of Material"),
            "fieldtype": "Data",
            "width": 220,
        },
        {
            "fieldname": "supplier",
            "label": _("Supplier"),
            "fieldtype": "Link",
            "options": "Supplier",
            "width": 200,
        },
        {
            "fieldname": "total_deliveries",
            "label": _("Total Deliveries"),
            "fieldtype": "Int",
            "width": 130,
        },
        {
            "fieldname": "deliveries_accepted",
            "label": _("Accepted Deliveries"),
            "fieldtype": "Int",
            "width": 150,
        },
        {
            "fieldname": "deliveries_rejected",
            "label": _("Rejected Deliveries"),
            "fieldtype": "Int",
            "width": 150,
        },
        {
            "fieldname": "quality_pct",
            "label": _("Quality %"),
            "fieldtype": "Percent",
            "width": 120,
        },
        {
            "fieldname": "on_time_delivery",
            "label": _("On Time Delivery"),
            "fieldtype": "Int",
            "width": 130,
        },
        {
            "fieldname": "deliveries_off_time",
            "label": _("Off Time Delivery"),
            "fieldtype": "Int",
            "width": 130,
        },
        {
            "fieldname": "delivery_pct",
            "label": _("Delivery %"),
            "fieldtype": "Percent",
            "width": 120,
        },
        {
            "fieldname": "overall_pct",
            "label": _("Overall Performance %"),
            "fieldtype": "Percent",
            "width": 150,
        },
        {
            "fieldname": "rating",
            "label": _("Rating"),
            "fieldtype": "Data",
            "width": 80,
        },
        {
            "fieldname": "remarks",
            "label": _("Remarks"),
            "fieldtype": "Data",
            "width": 300,
        },
    ]


# --------------------------------------------------------------------------
# DATA
# --------------------------------------------------------------------------

def get_data(filters):
    filters = filters or {}

    # Default dates if not passed
    if not filters.get("from_date"):
        filters["from_date"] = frappe.utils.month_start()

    if not filters.get("to_date"):
        filters["to_date"] = frappe.utils.month_end()

    conditions = _build_conditions(filters)

    query = f"""
        SELECT
            pri.item_code,
            pri.item_name,
            pr.supplier,
            pr.name AS receipt_name,
            pr.posting_date,
            pri.schedule_date,
            pri.qty,
            pri.rejected_qty,
            (pri.qty - pri.rejected_qty) AS accepted_qty
        FROM `tabPurchase Receipt` pr
        INNER JOIN `tabPurchase Receipt Item` pri
            ON pri.parent = pr.name
        INNER JOIN `tabItem` i
            ON i.name = pri.item_code
        WHERE
            pr.docstatus = 1
            AND pr.posting_date BETWEEN %(from_date)s AND %(to_date)s
            {conditions}
        ORDER BY
            pr.supplier, pri.item_code, pr.posting_date
    """

    rows = frappe.db.sql(query, filters, as_dict=True)

    aggregated = {}

    for row in rows:
        key = (row.item_name or row.item_code, row.supplier)

        if key not in aggregated:
            aggregated[key] = {
                "item_name": row.item_name or row.item_code,
                "supplier": row.supplier,
                "total_deliveries": 0,
                "deliveries_accepted": 0,
                "deliveries_rejected": 0,
                "on_time_delivery": 0,
                "deliveries_off_time": 0,
            }

        entry = aggregated[key]

        entry["total_deliveries"] += 1

        if flt(row.rejected_qty) == 0:
            entry["deliveries_accepted"] += 1
        else:
            entry["deliveries_rejected"] += 1

        # Delivery timing logic
        if not row.schedule_date or row.posting_date <= row.schedule_date:
            entry["on_time_delivery"] += 1
        else:
            entry["deliveries_off_time"] += 1

    data = []
    sr_no = 1

    for key, row in sorted(aggregated.items(), key=lambda x: (x[0][1], x[0][0])):
        total = row["total_deliveries"]
        accepted = row["deliveries_accepted"]
        rejected = row["deliveries_rejected"]
        on_time = row["on_time_delivery"]
        off_time = row["deliveries_off_time"]

        quality_pct = flt((accepted / total) * 100, 2) if total else 0
        delivery_pct = flt((on_time / total) * 100, 2) if total else 0
        overall_pct = flt((quality_pct + delivery_pct) / 2, 2)

        rating, remarks = _get_rating(overall_pct)

        if filters.get("rating") and filters.get("rating") != rating:
            continue

        data.append({
            "sr_no": sr_no,
            "item_name": row["item_name"],
            "supplier": row["supplier"],
            "total_deliveries": total,
            "deliveries_accepted": accepted,
            "deliveries_rejected": rejected,
            "quality_pct": quality_pct,
            "on_time_delivery": on_time,
            "deliveries_off_time": off_time,
            "delivery_pct": delivery_pct,
            "overall_pct": overall_pct,
            "rating": rating,
            "remarks": remarks,
        })

        sr_no += 1

    return data


# --------------------------------------------------------------------------
# CHART
# --------------------------------------------------------------------------

def get_chart_data(columns, data):
    if not data:
        return None

    labels = [f"{d['supplier']} / {d['item_name']}" for d in data]

    return {
        "data": {
            "labels": labels,
            "datasets": [
                {
                    "name": _("Quality %"),
                    "values": [d["quality_pct"] for d in data],
                    "chartType": "bar",
                },
                {
                    "name": _("Delivery %"),
                    "values": [d["delivery_pct"] for d in data],
                    "chartType": "bar",
                },
                {
                    "name": _("Overall %"),
                    "values": [d["overall_pct"] for d in data],
                    "chartType": "line",
                },
            ],
        },
        "type": "bar",
        "height": 300,
    }


# --------------------------------------------------------------------------
# SUMMARY
# --------------------------------------------------------------------------

def get_report_summary(data):
    if not data:
        return []

    total = len(data)

    avg_quality = flt(sum(d["quality_pct"] for d in data) / total, 2)
    avg_delivery = flt(sum(d["delivery_pct"] for d in data) / total, 2)
    avg_overall = flt(sum(d["overall_pct"] for d in data) / total, 2)

    return [
        {
            "label": _("Total Suppliers"),
            "value": total,
            "indicator": "Blue"
        },
        {
            "label": _("Average Quality %"),
            "value": avg_quality,
            "indicator": "Green"
        },
        {
            "label": _("Average Delivery %"),
            "value": avg_delivery,
            "indicator": "Orange"
        },
        {
            "label": _("Average Overall %"),
            "value": avg_overall,
            "indicator": "Purple"
        },
    ]


# --------------------------------------------------------------------------
# MAIN EXECUTE
# --------------------------------------------------------------------------

def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    chart = get_chart_data(columns, data)
    summary = get_report_summary(data)

    return columns, data, None, chart, summary


# --------------------------------------------------------------------------
# HELPERS
# --------------------------------------------------------------------------

def _get_rating(overall_pct):
    if overall_pct >= 90:
        return "A", "Excellent – Continue"
    elif overall_pct >= 51:
        return "B", "Good – Continue"
    elif overall_pct >= 1:
        return "C", "Poor – Needs Improvement"
    else:
        return "", "No Deliveries"


def _build_conditions(filters):
    conditions = ""

    if filters.get("supplier"):
        conditions += " AND pr.supplier = %(supplier)s "

    if filters.get("item_group"):
        conditions += " AND i.item_group = %(item_group)s "

    return conditions