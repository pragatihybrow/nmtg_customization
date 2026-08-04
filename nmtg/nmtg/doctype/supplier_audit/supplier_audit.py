# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class SupplierAudit(Document):
	def on_submit(self):
		if self.supplier:
			frappe.db.set_value("Supplier", self.supplier, "custom_supplier_audit_form_created", 1)