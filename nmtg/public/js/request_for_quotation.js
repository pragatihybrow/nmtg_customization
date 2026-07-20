frappe.ui.form.on("Request for Quotation", {
	refresh(frm) {
		if (frm.doc.docstatus === 1) {
			// remove the core "Supplier Quotation Comparison" button
			frm.remove_custom_button(__("Supplier Quotation Comparison"), __("View"));

			// add your own button pointing to the custom app's report
			frm.add_custom_button(
				__("Custom Supplier Quotation Comparison"),
				function () {
					frappe.route_options = {
						company: frm.doc.company,
						from_date: moment(frm.doc.transaction_date).format("YYYY-MM-DD"),
						to_date: moment(new Date()).format("YYYY-MM-DD"),
						request_for_quotation: frm.doc.name,
					};
					frappe.set_route("query-report", "Custom Supplier Quotation Comparison");
				},
				__("View")
			);
		}
	},
});