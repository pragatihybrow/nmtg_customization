# Copyright (c) 2026, Hybrowlabs and contributors
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
			"label": _("No."),
			"fieldname": "row_no",
			"fieldtype": "Int",
			"width": 50,
		},
		{
			"label": _("Indent No"),
			"fieldname": "parent",
			"fieldtype": "Link",
			"options": "Material Request",
			"width": 140,
		},
		{
			"label": _("Indent Date"),
			"fieldname": "transaction_date",
			"fieldtype": "Date",
			"width": 100,
		},
		{
			"label": _("Item Details"),
			"fieldname": "item_details",
			"fieldtype": "Data",
			"width": 220,
		},
		{
			"label": _("UOM"),
			"fieldname": "uom",
			"fieldtype": "Link",
			"options": "UOM",
			"width": 90,
		},
		{
			"label": _("Quantity"),
			"fieldname": "qty",
			"fieldtype": "Float",
			"width": 90,
		},
		{
			"label": _("Del. Date"),
			"fieldname": "schedule_date",
			"fieldtype": "Date",
			"width": 100,
		},
		{
			"label": _("Prepared By"),
			"fieldname": "prepared_by",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": _("Approved By"),
			"fieldname": "approved_by",
			"fieldtype": "Data",
			"width": 150,
		},
	]


def get_data(filters):
	conditions = get_conditions(filters)

	rows = frappe.db.sql(
		f"""
		SELECT
			mri.parent,
			mr.transaction_date,
			mri.item_code,
			mri.item_name,
			mri.description,
			mri.uom,
			mri.qty,
			mri.schedule_date,
			mr.owner AS prepared_by,
			mr.modified_by AS approved_by,
			mr.status,
			mr.company
		FROM `tabMaterial Request Item` mri
		INNER JOIN `tabMaterial Request` mr ON mr.name = mri.parent
		WHERE mr.docstatus = 1 {conditions}
		ORDER BY mr.transaction_date DESC, mri.parent, mri.idx
		""",
		filters,
		as_dict=1,
	)

	for i, row in enumerate(rows, start=1):
		row["row_no"] = i
		row["item_details"] = f"{row.get('item_code')} - {row.get('item_name')}"
		
	return rows


def get_conditions(filters):
	conditions = ""

	if filters.get("company"):
		conditions += " AND mr.company = %(company)s"

	if filters.get("indent_no"):
		conditions += " AND mri.parent = %(indent_no)s"

	if filters.get("status"):
		conditions += " AND mr.status = %(status)s"

	if filters.get("from_date"):
		conditions += " AND mr.transaction_date >= %(from_date)s"

	if filters.get("to_date"):
		conditions += " AND mr.transaction_date <= %(to_date)s"

	return conditions