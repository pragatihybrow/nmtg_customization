import re
import frappe
from frappe import _
from frappe.model.naming import getseries
from erpnext.stock.doctype.item.item import Item


class CustomItem(Item):
    def autoname(self):
        self.apply_item_settings()

    def validate(self):
        super().validate()
        self.validate_required_item_settings_fields()

    def validate_required_item_settings_fields(self):
        settings = frappe.get_single("Item Settings")
        matched_row = self.find_matching_item_settings_row(settings)

        if not matched_row or not matched_row.feilds:
            return

        missing = []
        for fieldname in matched_row.feilds.split(","):
            fieldname = fieldname.strip()
            if not fieldname or not self.meta.has_field(fieldname):
                continue

            value = self.get(fieldname)

            # Table / Table MultiSelect fields come as lists
            if isinstance(value, list):
                is_empty = len(value) == 0
            elif isinstance(value, str):
                is_empty = not value.strip()
            else:
                is_empty = value in (None, "")

            if is_empty:
                missing.append(_(self.meta.get_label(fieldname) or fieldname))

        if missing:
            frappe.throw(
                _("Mandatory fields required in Item: {0}").format(", ".join(missing)),
                frappe.MandatoryError,
            )

    def apply_item_settings(self):
        settings = frappe.get_single("Item Settings")

        matched_row = self.find_matching_item_settings_row(settings)

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

    def find_matching_item_settings_row(self, settings):
        def material_type_ok(row):
            if row.material_type:
                return row.material_type == self.custom_material_type
            return True

        # Tier 1: exact match on item_group + product_group + sub_product_group
        for row in settings.item_settings:
            if (row.item_group == self.item_group and
                row.product_group == self.custom_product_group and
                row.sub_product_group == self.custom_sub_product_group and
                material_type_ok(row)):
                return row

        # Tier 2: fallback — item_group + product_group only,
        # matched against a catch-all row with no sub_product_group set
        for row in settings.item_settings:
            if (row.item_group == self.item_group and
                row.product_group == self.custom_product_group and
                not row.sub_product_group and
                material_type_ok(row)):
                return row

        return None

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