# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

# Fields that must never be copied between child rows
SKIP_FIELDS = {
    "name", "owner", "creation", "modified", "modified_by",
    "idx", "docstatus", "parent", "parentfield", "parenttype", "doctype"
}


class EnquiryItemSummary(Document):
    def on_submit(self):
        self.generate_request_numbers()
        self.update_opportunity_items()

    def generate_request_numbers(self):
        for idx, row in enumerate(self.item_summary, start=1):
            row.custom_request_no = f"R-{idx:03d}"

    def update_opportunity_items(self):
        if not self.opportunity_no:
            return

        opp = frappe.get_doc("Opportunity", self.opportunity_no)
        meta = frappe.get_meta("Opportunity Item")
        fieldnames = [df.fieldname for df in meta.fields if df.fieldname not in SKIP_FIELDS]

        for summary_row in self.item_summary:
            target_row = None
            for opp_row in opp.items:
                if opp_row.item_code == summary_row.item_code:
                    target_row = opp_row
                    break

            if not target_row:
                target_row = opp.append("items", {})

            for fieldname in fieldnames:
                value = summary_row.get(fieldname)
                if value is not None:
                    target_row.set(fieldname, value)

        opp.flags.ignore_validate_update_after_submit = True
        opp.flags.ignore_mandatory = True
        opp.save(ignore_permissions=True)