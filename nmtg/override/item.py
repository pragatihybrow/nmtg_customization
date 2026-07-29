import re
import frappe
from frappe.model.naming import getseries
from erpnext.stock.doctype.item.item import Item


class CustomItem(Item):
    def autoname(self):
        self.apply_item_settings()

    def apply_item_settings(self):
        settings = frappe.get_single("Item Settings")

        matched_row = None
        for row in settings.item_settings:
            if (row.item_group == self.item_group and
                row.product_group == self.custom_product_group and
                row.sub_product_group == self.custom_sub_product_group):

                if row.material_type:
                    if row.material_type == self.custom_material_type:
                        matched_row = row
                        break
                else:
                    matched_row = row
                    break

        if not matched_row:
            frappe.throw(f"No Item Settings found for: {self.item_group} / {self.custom_product_group} / {self.custom_sub_product_group}")

        seq_digits = matched_row.sequence_digits or 4
        TABLE_VALUE_FIELDNAME = {
            "custom_models": "model",
            "custom_customer_type": "customer_type",
            "custom_industry": "industry",
            "custom_application": "application",
        }

        # Build context, handling table / table multiselect fields specially
        ctx = {}
        for k, v in self.as_dict().items():
            if isinstance(v, list):
                child_fieldname = TABLE_VALUE_FIELDNAME.get(k)
                values = []
                if child_fieldname:
                    for child in v:
                        child_val = (
                            child.get(child_fieldname)
                            if isinstance(child, dict)
                            else getattr(child, child_fieldname, None)
                        )
                        if child_val:
                            values.append(str(child_val))
                ctx[k] = ", ".join(values)
            else:
                ctx[k] = str(v) if v is not None else ""

        def apply_pattern(pattern, context):
            pattern = pattern.replace("\n", "").strip()
            def replacer(match):
                key = match.group(1)
                return context.get(key, "")
            return re.sub(r"\{(\w+)\}", replacer, pattern)

        code_pattern = matched_row.code_pattern.replace("\n", "").strip()

        ctx_no_seq = dict(ctx)
        ctx_no_seq["sequence"] = ""
        code_prefix = apply_pattern(code_pattern, ctx_no_seq)

        self.seed_series_if_missing(code_prefix, seq_digits)

        next_seq = getseries(code_prefix, seq_digits)

        ctx["sequence"] = next_seq

        self.item_name = apply_pattern(matched_row.name_pattern, ctx)
        self.item_code = code_prefix + next_seq
        self.name = self.item_code

    def seed_series_if_missing(self, code_prefix, seq_digits):
        if frappe.db.exists("Series", code_prefix):
            return

        last_item = frappe.db.sql("""
            SELECT item_code FROM `tabItem`
            WHERE item_code LIKE %s
            ORDER BY item_code DESC
            LIMIT 1
        """, (code_prefix + "%",), as_dict=True)

        current = 0
        if last_item:
            suffix = last_item[0]["item_code"][len(code_prefix):]
            if suffix.isdigit():
                current = int(suffix)

        frappe.db.sql("""
            INSERT INTO `tabSeries` (name, current)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE current = GREATEST(current, %s)
        """, (code_prefix, current, current))