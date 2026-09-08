// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Quotation History Item wise & Customer wise"] = {
	"filters": [
		{
			"fieldname": "view_by",
			"label": __("View By"),
			"fieldtype": "Select",
			"options": ["Item Wise", "Customer Wise"],
			"default": "Item Wise",
			"reqd": 1
		},
		{
			"fieldname": "company",
			"label": __("Company"),
			"fieldtype": "Link",
			"options": "Company",
			"default": frappe.defaults.get_user_default("Company")
		},
		{
			"fieldname": "customer_name",
			"label": __("Customer"),
			"fieldtype": "Data"
		},
		{
			"fieldname": "item_code",
			"label": __("Item Code"),
			"fieldtype": "Link",
			"options": "Item"
		},
		{
			"fieldname": "from_date",
			"label": __("From Date"),
			"fieldtype": "Date"
		},
		{
			"fieldname": "to_date",
			"label": __("To Date"),
			"fieldtype": "Date"
		}
	]
};