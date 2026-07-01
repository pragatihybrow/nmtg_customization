# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today



class CAPAReport(Document):
	def before_insert(self):
		# Set today's date automatically
		if not self.date:
			self.date = today()

		# Auto generate NCPR number
		if not self.ncpr_no:
			self.ncpr_no = frappe.model.naming.make_autoname("NCPR-.YYYY.-.#####")
