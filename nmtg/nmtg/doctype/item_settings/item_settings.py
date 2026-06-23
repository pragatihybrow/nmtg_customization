# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class ItemSettings(Document):
    def validate(self):
        self.validate_duplicate_hierarchy()

    def validate_duplicate_hierarchy(self):
        seen = set()

        for row in self.item_settings:
            key = (
                row.item_group,
                row.product_group,
                row.sub_product_group,
                row.material_type
            )

            if key in seen:
                frappe.throw(
                    f"Duplicate hierarchy found:\n"
                    f"Item Group: {row.item_group}\n"
                    f"Product Group: {row.product_group}\n"
                    f"Sub Product Group: {row.sub_product_group}\n"
                    f"Material Type: {row.material_type or 'Blank'}"
                )

            seen.add(key)