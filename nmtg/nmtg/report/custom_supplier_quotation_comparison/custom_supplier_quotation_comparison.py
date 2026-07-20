# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt
import re
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, flt

from erpnext.setup.utils import get_exchange_rate


def execute(filters=None):
	if not filters:
		return [], []

	validate_filters(filters)

	term_options = get_payment_term_options()
	columns = get_columns(filters, term_options)
	supplier_quotation_data = get_data(filters)

	quotations = list(set(d.get("parent") for d in supplier_quotation_data if d.get("parent")))
	payment_terms_map = get_payment_terms_map(quotations)

	data, chart_data = prepare_data(supplier_quotation_data, filters, payment_terms_map, term_options)
	message = get_message()

	return columns, data, message, chart_data


def validate_filters(filters):
	if not filters.get("categorize_by") and filters.get("group_by"):
		filters["categorize_by"] = filters["group_by"]
		filters["categorize_by"] = filters["categorize_by"].replace("Group by", "Categorize by")


def slugify(label):
	"""Convert a term label like 'Against Proforma / Dispatch' into a safe
	fieldname fragment like 'against_proforma_dispatch'."""
	return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


def get_payment_term_options():
	"""Read the Select options directly off the 'terms' field of
	Supplier Payment Terms CT, so columns stay in sync if options change."""
	meta = frappe.get_meta("Supplier Payment Terms CT")
	field = meta.get_field("terms")
	options = [opt.strip() for opt in (field.options or "").split("\n") if opt.strip()]
	return options


def get_data(filters):
	sq = frappe.qb.DocType("Supplier Quotation")
	sq_item = frappe.qb.DocType("Supplier Quotation Item")

	query = (
		frappe.qb.from_(sq_item)
		.from_(sq)
		.select(
			sq_item.parent,
			sq_item.item_code,
			sq_item.qty,
			sq.currency,
			sq_item.stock_qty,
			sq_item.amount,
			sq_item.base_rate,
			sq_item.base_amount,
			sq.price_list_currency,
			sq_item.uom,
			sq_item.stock_uom,
			sq_item.request_for_quotation,
			sq_item.lead_time_days,
			sq.supplier.as_("supplier_name"),
			sq.valid_till,
			sq.custom_quality_category,
		)
		.where(
			(sq_item.parent == sq.name)
			& (sq_item.docstatus < 2)
			& (sq.company == filters.get("company"))
			& (sq.transaction_date.between(filters.get("from_date"), filters.get("to_date")))
		)
		.orderby(sq.transaction_date, sq_item.item_code)
	)

	if filters.get("item_code"):
		query = query.where(sq_item.item_code == filters.get("item_code"))

	if filters.get("supplier_quotation"):
		query = query.where(sq_item.parent.isin(filters.get("supplier_quotation")))

	if filters.get("request_for_quotation"):
		query = query.where(sq_item.request_for_quotation == filters.get("request_for_quotation"))

	if filters.get("supplier"):
		query = query.where(sq.supplier.isin(filters.get("supplier")))

	if not filters.get("include_expired"):
		query = query.where(sq.status != "Expired")

	supplier_quotation_data = query.run(as_dict=True)

	return supplier_quotation_data


def get_payment_terms_map(quotations):
	"""Build {quotation: {term_label: {'percentage':.., 'amount':.., 'days':..}}}"""
	if not quotations:
		return {}

	terms_table = frappe.qb.DocType("Supplier Payment Terms CT")

	terms_data = (
		frappe.qb.from_(terms_table)
		.select(
			terms_table.parent,
			terms_table.terms,
			terms_table.percentage,
			terms_table.amount,
			terms_table.days,
		)
		.where(terms_table.parent.isin(quotations))
		.orderby(terms_table.parent, terms_table.idx)
	).run(as_dict=True)

	payment_terms_map = defaultdict(dict)
	for row in terms_data:
		if not row.terms:
			continue
		payment_terms_map[row.parent][row.terms] = {
			"percentage": flt(row.percentage, 2),
			"amount": flt(row.amount, 2),
			"days": row.days,
		}

	return payment_terms_map


def prepare_chart_data(suppliers, qty_list, supplier_qty_price_map):
	data_points_map = {}
	qty_list.sort()

	# create qty wise values map of the form {'qty1':[value1, value2]}
	for supplier in suppliers:
		entry = supplier_qty_price_map[supplier]
		for qty in qty_list:
			if qty not in data_points_map:
				data_points_map[qty] = []
			if qty in entry:
				data_points_map[qty].append(entry[qty])
			else:
				data_points_map[qty].append(None)

	dataset = []
	currency_symbol = frappe.db.get_value("Currency", frappe.db.get_default("currency"), "symbol")
	for qty in qty_list:
		datapoints = {
			"name": currency_symbol + " (Qty " + str(qty) + " )",
			"values": data_points_map[qty],
		}
		dataset.append(datapoints)

	chart_data = {"data": {"labels": suppliers, "datasets": dataset}, "type": "bar"}

	return chart_data

def prepare_data(supplier_quotation_data, filters, payment_terms_map=None, term_options=None):
	payment_terms_map = payment_terms_map or {}
	term_options = term_options or []

	out, groups, qty_list, suppliers, chart_data = [], [], [], [], []
	group_wise_map = defaultdict(list)
	supplier_qty_price_map = {}

	group_by_field = (
		"supplier_name" if filters.get("categorize_by") == "Categorize by Supplier" else "item_code"
	)
	float_precision = cint(frappe.db.get_default("float_precision")) or 2

	for data in supplier_quotation_data:
		group = data.get(group_by_field)  # get item or supplier value for this row

		row = {
			"item_code": ""
			if group_by_field == "item_code"
			else data.get("item_code"),  # leave blank if group by field
			"supplier_name": "" if group_by_field == "supplier_name" else data.get("supplier_name"),
			"quotation": data.get("parent"),
			"qty": data.get("qty"),
			"price": flt(data.get("amount"), float_precision),
			"uom": data.get("uom"),
			"price_list_currency": data.get("price_list_currency"),
			"currency": data.get("currency"),
			"stock_uom": data.get("stock_uom"),
			"base_amount": flt(data.get("base_amount"), float_precision),
			"base_rate": flt(data.get("base_rate"), float_precision),
			"request_for_quotation": data.get("request_for_quotation"),
			"valid_till": data.get("valid_till"),
			"lead_time_days": data.get("lead_time_days"),
			"custom_quality_category": data.get("custom_quality_category"),
		}

		# dynamically populate %, amount, and (for Against GRN) days per term
		quotation_terms = payment_terms_map.get(data.get("parent"), {})
		for term in term_options:
			slug = slugify(term)
			term_entry = quotation_terms.get(term)

			row["term_%s" % slug] = term_entry.get("percentage") if term_entry else None
			row["term_%s_amount" % slug] = term_entry.get("amount") if term_entry else None

			if term == "Against GRN":
				row["term_against_grn_days"] = term_entry.get("days") if term_entry else None

		row["price_per_unit"] = flt(row["price"]) / (flt(data.get("stock_qty")) or 1)

		# map for report view of form {'supplier1'/'item1':[{},{},...]}
		group_wise_map[group].append(row)

		# map for chart preparation of the form {'supplier1': {'qty': 'price'}}
		supplier = data.get("supplier_name")
		if filters.get("item_code"):
			if supplier not in supplier_qty_price_map:
				supplier_qty_price_map[supplier] = {}
			supplier_qty_price_map[supplier][row["qty"]] = row["price"]

		groups.append(group)
		suppliers.append(supplier)
		qty_list.append(data.get("qty"))

	groups = list(set(groups))
	suppliers = list(set(suppliers))
	qty_list = list(set(qty_list))

	highlight_min_price = group_by_field == "item_code" or filters.get("item_code")

	# final data format for report view
	for group in groups:
		group_entries = group_wise_map[group]  # all entries pertaining to item/supplier
		group_entries[0].update({group_by_field: group})  # Add item/supplier name in first group row

		if highlight_min_price:
			prices = [group_entry["price_per_unit"] for group_entry in group_entries]
			min_price = min(prices)

		for entry in group_entries:
			if highlight_min_price and entry["price_per_unit"] == min_price:
				entry["min"] = 1
			out.append(entry)

	if filters.get("item_code"):
		# render chart only for one item comparison
		chart_data = prepare_chart_data(suppliers, qty_list, supplier_qty_price_map)

	return out, chart_data


def get_columns(filters, term_options=None):
	term_options = term_options or []
	currency = frappe.get_cached_value("Company", filters.get("company"), "default_currency")

	group_by_columns = [
		{
			"fieldname": "supplier_name",
			"label": _("Supplier"),
			"fieldtype": "Link",
			"options": "Supplier",
			"width": 150,
		},
		{
			"fieldname": "item_code",
			"label": _("Item"),
			"fieldtype": "Link",
			"options": "Item",
			"width": 150,
		},
	]

	columns = [
		{"fieldname": "uom", "label": _("UOM"), "fieldtype": "Link", "options": "UOM", "width": 90},
		{"fieldname": "qty", "label": _("Quantity"), "fieldtype": "Float", "width": 80},
		{
			"fieldname": "stock_uom",
			"label": _("Stock UOM"),
			"fieldtype": "Link",
			"options": "UOM",
			"width": 90,
		},
		{
			"fieldname": "currency",
			"label": _("Currency"),
			"fieldtype": "Link",
			"options": "Currency",
			"width": 110,
		},
		{
			"fieldname": "price",
			"label": _("Price"),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 110,
		},
		{
			"fieldname": "price_per_unit",
			"label": _("Price per Unit (Stock UOM)"),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120,
		},
		{
			"fieldname": "base_amount",
			"label": _("Price ({0})").format(currency),
			"fieldtype": "Currency",
			"options": "price_list_currency",
			"width": 180,
		},
		{
			"fieldname": "base_rate",
			"label": _("Price Per Unit ({0})").format(currency),
			"fieldtype": "Currency",
			"options": "price_list_currency",
			"width": 180,
		},
		{
			"fieldname": "quotation",
			"label": _("Supplier Quotation"),
			"fieldtype": "Link",
			"options": "Supplier Quotation",
			"width": 200,
		},
		{"fieldname": "valid_till", "label": _("Valid Till"), "fieldtype": "Date", "width": 100},
		{
			"fieldname": "lead_time_days",
			"label": _("Lead Time (Days)"),
			"fieldtype": "Int",
			"width": 100,
		},
		{
			"fieldname": "request_for_quotation",
			"label": _("Request for Quotation"),
			"fieldtype": "Link",
			"options": "Request for Quotation",
			"width": 150,
		},
		{
			"fieldname": "custom_quality_category",
			"label": _("Quality Category"),
			"fieldtype": "Data",
			"width": 150,
		},
	]

	# per term: a % column, an Amount column, and (for Against GRN) a Days column
	for term in term_options:
		slug = slugify(term)

		columns.append(
			{
				"fieldname": "term_%s" % slug,
				"label": _("%s (%%)") % term,
				"fieldtype": "Percent",
				"width": 130,
			}
		)
		columns.append(
			{
				"fieldname": "term_%s_amount" % slug,
				"label": _("%s (Amount)") % term,
				"fieldtype": "Currency",
				"options": "currency",
				"width": 130,
			}
		)
		if term == "Against GRN":
			columns.append(
				{
					"fieldname": "term_against_grn_days",
					"label": _("Credit Days Aginst GRN"),
					"fieldtype": "Data",
					"width": 130,
				}
			)

	if filters.get("categorize_by") == "Categorize by Item":
		group_by_columns.reverse()

	columns[0:0] = group_by_columns  # add positioned group by columns to the report
	return columns


def get_message():
	return f"""<span class="indicator">
		{_("Valid Till")}:&nbsp;&nbsp;
		</span>
		<span class="indicator orange">
		{_("Expires in a week or less")}
		</span>
		&nbsp;&nbsp;
		<span class="indicator red">
		{_("Expires today or already expired")}
		</span>"""


@frappe.whitelist()
def set_default_supplier(item_code: str, supplier: str, company: str):
	frappe.has_permission("Item", "write", doc=item_code, throw=True)
	frappe.db.set_value(
		"Item Default",
		{"parent": item_code, "company": company},
		"default_supplier",
		supplier,
	)