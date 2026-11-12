// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

frappe.query_reports["Receivable Payment Plan Report"] = {
	tree: true,
	name_field: "name",
	parent_field: "parent_so",
	initial_depth: 0,

	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
		{
			fieldname: "sales_order",
			label: __("Sales Order"),
			fieldtype: "Link",
			options: "Sales Order",
		},
		{
			fieldname: "from_date",
			label: __("SO From Date"),
			fieldtype: "Date",
		},
		{
			fieldname: "to_date",
			label: __("SO To Date"),
			fieldtype: "Date",
		},
		{
			fieldname: "ld",
			label: __("LD?"),
			fieldtype: "Select",
			options: ["", "Yes", "No"],
		},
		{
			fieldname: "pending_only",
			label: __("Pending Payment Only"),
			fieldtype: "Check",
			default: 0,
		},
	],

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);

		if (data && data.indent === 0) {
			value = "<span style='font-weight:600'>" + value + "</span>";
		}
		if (
			data &&
			column.fieldname === "ad_remaining_days" &&
			data.ad_remaining_days !== null &&
			data.ad_remaining_days !== undefined &&
			data.ad_remaining_days < 0
		) {
			value = "<span style='color:#c0392b;font-weight:600'>" + value + "</span>";
		}
		return value;
	},
};