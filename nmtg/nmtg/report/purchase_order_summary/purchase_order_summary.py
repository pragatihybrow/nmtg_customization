# Copyright (c) 2026, Frappe Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"label": _("PO No"),
			"fieldname": "name",
			"fieldtype": "Link",
			"options": "Purchase Order",
			"width": 150,
		},
		{
			"label": _("PO Date"),
			"fieldname": "transaction_date",
			"fieldtype": "Date",
			"width": 100,
		},
		{
			"label": _("Vendor Name"),
			"fieldname": "supplier_name",
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"label": _("Net Amount"),
			"fieldname": "base_net_total",
			"fieldtype": "Currency",
			"options": "Company:company:default_currency",
			"width": 130,
		},
		{
			"label": _("Gross Amount"),
			"fieldname": "base_grand_total",
			"fieldtype": "Currency",
			"options": "Company:company:default_currency",
			"width": 130,
		},
		{
			"label": _("Status"),
			"fieldname": "delivery_status",
			"fieldtype": "Data",
			"width": 110,
		},
		{
			"label": _("Stage"),
			"fieldname": "status",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": _("Workflow State"),
			"fieldname": "workflow_state",
			"fieldtype": "Data",
			"width": 150,
		},
	]


def get_data(filters):
	conditions = get_conditions(filters)

	po_list = frappe.db.sql(
		f"""
		SELECT
			po.name,
			po.transaction_date,
			po.supplier_name,
			po.base_net_total,
			po.base_grand_total,
			po.status,
			po.workflow_state,
			po.company,
			po.per_received,
			po.per_billed,
			po.schedule_date
		FROM `tabPurchase Order` po
		WHERE po.docstatus = 1 {conditions}
		ORDER BY po.transaction_date DESC
		""",
		filters,
		as_dict=1,
	)

	for row in po_list:
		row["delivery_status"] = get_delivery_status(row)

	return po_list


def get_conditions(filters):
	conditions = ""

	if filters.get("company"):
		conditions += " AND po.company = %(company)s"

	if filters.get("supplier"):
		conditions += " AND po.supplier = %(supplier)s"

	if filters.get("status"):
		conditions += " AND po.status = %(status)s"

	if filters.get("from_date"):
		conditions += " AND po.transaction_date >= %(from_date)s"

	if filters.get("to_date"):
		conditions += " AND po.transaction_date <= %(to_date)s"

	return conditions


def get_delivery_status(row):
	"""Simple on-time / overdue indicator based on schedule date and receipt %."""
	if row.get("per_received", 0) >= 100:
		return _("Received")

	if row.get("schedule_date") and frappe.utils.getdate(row["schedule_date"]) < frappe.utils.getdate(
		frappe.utils.nowdate()
	):
		return _("Overdue")

	return _("On Time")