import re
import frappe
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
        ctx = {k: str(v) if v is not None else "" for k, v in self.as_dict().items()}

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

        last_item = frappe.db.sql("""
            SELECT item_code FROM `tabItem`
            WHERE item_code LIKE %s
            ORDER BY item_code DESC
            LIMIT 1
        """, (code_prefix + "%",), as_dict=True)

        if last_item:
            last_code = last_item[0]["item_code"]
            suffix = last_code[len(code_prefix):]
            try:
                next_seq = int(suffix) + 1
            except ValueError:
                next_seq = 1
        else:
            next_seq = 1

        ctx["sequence"] = str(next_seq).zfill(seq_digits)

        self.item_name = apply_pattern(matched_row.name_pattern, ctx)
        self.item_code = apply_pattern(code_pattern, ctx)
        self.name = self.item_code