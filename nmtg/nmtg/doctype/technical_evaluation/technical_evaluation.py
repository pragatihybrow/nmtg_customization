# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class TechnicalEvaluation(Document):

    def before_insert(self):
        self.set_version()

    def before_save(self):
        self.generate_request_numbers()

    def on_update(self):
        self.update_opportunity_status()

    def on_submit(self):
        self.sync_items_to_opportunity()
        self.update_opportunity_status()

    def on_cancel(self):
        self.update_opportunity_status()

    def set_version(self):
        if not self.opportunity_no:
            self.version = "V1"
            return

        existing_count = frappe.db.count(
            "Technical Evaluation",
            filters={
                "opportunity_no": self.opportunity_no,
                "docstatus": ["!=", 2],
            },
        )

        self.version = f"V{existing_count + 1}"

    def generate_request_numbers(self):
        for idx, row in enumerate(self.items, start=1):
            row.request_no = f"R-{idx:03d}"

    def update_opportunity_status(self):
        """
        Update Opportunity status according to the
        latest Technical Evaluation version.

        Latest TE Draft:
            Technical Evaluation Under Review

        Latest TE Submitted:
            Technical Evaluation Cleared
        """

        if not self.opportunity_no:
            return

        evaluations = frappe.get_all(
            "Technical Evaluation",
            filters={
                "opportunity_no": self.opportunity_no,
                "docstatus": ["!=", 2],
            },
            fields=[
                "name",
                "version",
                "docstatus",
            ],
        )

        if not evaluations:
            return

        # Get latest version
        latest_evaluation = max(
            evaluations,
            key=lambda d: self.get_version_number(d.version) or 0
        )

        latest_version = self.get_version_number(
            latest_evaluation.version
        )

        if latest_version is None:
            return

        # Latest TE is Draft
        if latest_evaluation.docstatus == 0:
            status = "Technical Evaluation Under Review"

        # Latest TE is Submitted
        elif latest_evaluation.docstatus == 1:
            status = "Technical Evaluation Cleared"

        else:
            return

        # Get current Opportunity status
        current_status = frappe.db.get_value(
            "Opportunity",
            self.opportunity_no,
            "status"
        )

        # Update only if status has changed
        if current_status != status:
            frappe.db.set_value(
                "Opportunity",
                self.opportunity_no,
                "status",
                status,
                update_modified=True,
            )

    def sync_items_to_opportunity(self):
        if not self.opportunity_no:
            return

        opportunity = frappe.get_doc(
            "Opportunity",
            self.opportunity_no
        )

        new_version_no = self.get_version_number(
            self.version
        )

        # Group existing opportunity items by item_code
        opp_items_by_code = {}

        for opp_item in opportunity.items:
            if opp_item.item_code:
                opp_items_by_code.setdefault(
                    opp_item.item_code,
                    []
                ).append(opp_item)

        updated = False

        for idx, te_item in enumerate(self.items):
            opp_item = None
            is_new_row = False

            # 1. Match by item_code
            if (
                te_item.item_code
                and opp_items_by_code.get(te_item.item_code)
            ):
                opp_item = opp_items_by_code[
                    te_item.item_code
                ].pop(0)

            # 2. Fallback to row position
            elif (
                not te_item.item_code
                and idx < len(opportunity.items)
            ):
                opp_item = opportunity.items[idx]

            # 3. Create new row
            else:
                opp_item = opportunity.append(
                    "items",
                    {}
                )

                opp_item.item_code = te_item.item_code
                opp_item.qty = te_item.qty or 1
                opp_item.rate = 0
                opp_item.amount = 0
                opp_item.base_rate = 0
                opp_item.base_amount = 0

                is_new_row = True

            # Don't overwrite a newer TE version
            if not is_new_row:

                existing_version_no = self.get_version_number(
                    opp_item.custom_version
                )

                if (
                    existing_version_no is not None
                    and existing_version_no > new_version_no
                ):
                    continue

            opp_item.custom_request_no = te_item.request_no
            opp_item.custom_product_group = te_item.product_group

            opp_item.custom_customer_requirement_brief_description = (
                te_item.customer_requirement__brief
            )

            opp_item.custom_selected_model = (
                te_item.nmtg_model
            )

            opp_item.custom_technical_evaluation = self.name

            opp_item.custom_technical_status = (
                te_item.technical_status
            )

            opp_item.custom_selection_type = (
                te_item.selection_type
            )

            opp_item.custom_remarks = (
                te_item.remark
            )

            opp_item.custom_version = self.version

            updated = True

        if updated:
            opportunity.flags.ignore_permissions = True
            opportunity.flags.ignore_validate_update_after_submit = True
            opportunity.save()

    @staticmethod
    def get_version_number(version_str):
        """
        Convert V4 -> 4.
        Returns None for blank/invalid values.
        """

        if not version_str:
            return None

        try:
            return int(
                str(version_str).lstrip("Vv")
            )

        except (ValueError, TypeError):
            return None