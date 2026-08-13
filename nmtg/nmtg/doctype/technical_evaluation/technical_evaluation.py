# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class TechnicalEvaluation(Document):
    def before_insert(self):
        self.set_version()

    def before_save(self):
        self.generate_request_numbers()

    def on_submit(self):
        self.sync_items_to_opportunity()

    def set_version(self):
        """Auto-increment version when multiple Technical Evaluations
        are created against the same Opportunity."""
        if not self.opportunity_no:
            self.version = "V1"
            return

        existing_count = frappe.db.count(
            "Technical Evaluation",
            filters={
                "opportunity_no": self.opportunity_no,
                "docstatus": ["!=", 2],  # exclude cancelled
            },
        )

        self.version = f"V{existing_count + 1}"

    def generate_request_numbers(self):
        for idx, row in enumerate(self.items, start=1):
            row.request_no = f"R-{idx:03d}"

    def sync_items_to_opportunity(self):
        """Push Technical Evaluation Item data onto the linked
        Opportunity's items table, creating rows if they don't exist yet."""
        if not self.opportunity_no:
            return

        opportunity = frappe.get_doc("Opportunity", self.opportunity_no)

        # Group existing opportunity items by item_code for matching.
        opp_items_by_code = {}
        for opp_item in opportunity.items:
            if opp_item.item_code:
                opp_items_by_code.setdefault(opp_item.item_code, []).append(opp_item)

        updated = False

        for idx, te_item in enumerate(self.items):
            opp_item = None

            # 1. Try matching an existing row by item_code
            if te_item.item_code and opp_items_by_code.get(te_item.item_code):
                opp_item = opp_items_by_code[te_item.item_code].pop(0)
            # 2. Fallback: match by row position, if that many rows exist
            elif not te_item.item_code and idx < len(opportunity.items):
                opp_item = opportunity.items[idx]
            # 3. No match found — create a new Opportunity Item row
            else:
                opp_item = opportunity.append("items", {})
                opp_item.item_code = te_item.item_code
                opp_item.qty = te_item.qty or 1
                opp_item.rate = opp_item.rate or 0
                opp_item.amount = opp_item.amount or 0
                opp_item.base_rate = opp_item.base_rate or 0
                opp_item.base_amount = opp_item.base_amount or 0

            opp_item.custom_request_no = te_item.request_no
            opp_item.custom_product_group = te_item.product_group
            opp_item.custom_customer_requirement_brief_description = te_item.customer_requirement__brief
            opp_item.custom_selected_model = te_item.nmtg_model
            opp_item.custom_technical_evaluation = self.name
            opp_item.custom_technical_status = te_item.technical_status
            opp_item.custom_selection_type = te_item.selection_type
            opp_item.custom_remarks = te_item.remark
            opp_item.custom_version = self.version

            updated = True

        if updated:
            opportunity.flags.ignore_permissions = True
            opportunity.flags.ignore_validate_update_after_submit = True
            opportunity.save()