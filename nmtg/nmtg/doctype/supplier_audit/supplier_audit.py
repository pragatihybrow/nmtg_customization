# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class SupplierAudit(Document):
	def on_submit(self):
		if self.supplier and self.workflow_state == "Approved By Quality":
			frappe.db.set_value("Supplier", self.supplier, "custom_supplier_audit_form_created", 1)

	def before_insert(self):
		self.audit_version = str(self.get_next_audit_version())

	def get_next_audit_version(self):
		result = frappe.db.sql(
			"""
			SELECT MAX(CAST(audit_version AS UNSIGNED))
			FROM `tabSupplier Audit`
			WHERE supplier = %s AND docstatus != 2
			""",
			(self.supplier,),
		)
		last_version = result[0][0] if result else None
		return (last_version or 0) + 1