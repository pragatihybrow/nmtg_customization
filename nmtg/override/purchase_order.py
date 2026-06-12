import frappe
from frappe.utils import money_in_words, flt
from erpnext.buying.doctype.purchase_order.purchase_order import PurchaseOrder


class CustomPurchaseOrder(PurchaseOrder):

    HEADER_FALLBACK = [
        "in_words",
        "base_in_words",
    ]

    ITEM_FALLBACK = [
        "rate_with_margin",
        "base_rate_with_margin",
        "discount_percentage",
        "discount_amount",
        "margin_type",
        "margin_rate_or_amount",
        "price_list_rate",
        "base_price_list_rate",
    ]

    def validate(self):
        super().validate()

        # Custom validations
        self.validate_supplier_qc()

        # Existing custom logic
        self._set_in_words()

    def before_update_after_submit(self):
        if hasattr(PurchaseOrder, "before_update_after_submit"):
            super().before_update_after_submit()

        self.validate_supplier_qc()
        self._set_in_words()
        self._sync_computed_fields_from_db()


    def validate_supplier_qc(self):

        used_ranges = {}

        for qc in self.custom_supplier_selection_for_qc:

            if not qc.nmtg_heat_number:
                continue

            matching_item = next(
                (item for item in self.items if item.item_code == qc.item),
                None
            )

            if not matching_item:
                frappe.throw(f"Item <b>{qc.item}</b> not found in Purchase Order.")

            try:
                po_hn = matching_item.custom_nmtg_heat_number.strip()

                if " - " in po_hn:
                    po_start, po_end = [
                        int(x.strip().replace("NK", ""))
                        for x in po_hn.split(" - ")
                    ]
                else:
                    po_num = int(po_hn.replace("NK", "").strip())
                    po_start, po_end = po_num, po_num

                qc_hn = qc.nmtg_heat_number.strip().replace("\n", "")

                if " - " in qc_hn:
                    qc_start, qc_end = [
                        int(x.strip().replace("NK", ""))
                        for x in qc_hn.split(" - ")
                    ]
                else:
                    qc_num = int(qc_hn.replace("NK", "").strip())
                    qc_start, qc_end = qc_num, qc_num

            except Exception:
                frappe.throw(
                    f"""
                    Invalid Heat Number format.<br><br>
                    Expected: <b>NK5405 - NK5454</b> or <b>NK5833</b><br>
                    Entered: <b>{qc.nmtg_heat_number}</b>
                    """
                )

            # =====================================================
            # Single heat number items — just verify it matches
            # the PO item's heat number; skip qty/overlap checks
            # =====================================================
            if matching_item.custom_single_heat_number:
                po_hn_normalized = po_hn.split(" - ")[0].strip()  # "NK5833"
                qc_hn_normalized = qc_hn.split(" - ")[0].strip()  # handles "NK5833 - NK5833" too
                if qc_hn_normalized != po_hn_normalized:
                    frappe.throw(
                        f"""
                        Heat Number does not match PO Heat Number.<br><br>
                        PO Heat Number: <b>{matching_item.custom_nmtg_heat_number}</b><br>
                        Entered: <b>{qc.nmtg_heat_number}</b>
                        """
                    )
                continue  # skip all range/overlap/qty logic below

            # Validate range inside PO range
            if not (po_start <= qc_start <= po_end and qc_end <= po_end):
                frappe.throw(
                    f"""
                    Heat Number range outside PO range.<br><br>
                    PO Range: <b>{matching_item.custom_nmtg_heat_number}</b><br>
                    Entered: <b>{qc.nmtg_heat_number}</b>
                    """
                )

            existing = used_ranges.get(qc.item, [])
            existing.sort(key=lambda x: x[0])

            # Overlap validation
            for old_start, old_end, old_range in existing:
                overlap = (qc_start <= old_end and qc_end >= old_start)
                if overlap:
                    next_available = old_end + 1
                    expected_end = next_available + int(qc.qty) - 1
                    if expected_end > po_end:
                        expected_end = po_end
                    frappe.throw(
                        f"""
                        Heat Number range overlap detected.<br><br>
                        Existing Range: <b>{old_range}</b><br><br>
                        New Range: <b>NK{next_available} - NK{expected_end}</b>
                        """
                    )

            # Qty validation
            calculated_qty = (qc_end - qc_start) + 1
            if flt(qc.qty) != calculated_qty:
                next_available = qc_start
                if existing:
                    max_used = max(end for _, end, _ in existing)
                    next_available = max_used + 1
                expected_end = next_available + int(qc.qty) - 1
                if expected_end > po_end:
                    expected_end = po_end
                frappe.throw(
                    f"""
                    Quantity does not match Heat Number range.<br><br>
                    Entered Range: <b>{qc.nmtg_heat_number}</b><br>
                    Entered Qty: <b>{qc.qty}</b><br><br>
                    Correct Range: <b>NK{next_available} - NK{expected_end}</b>
                    """
                )

            existing.append((qc_start, qc_end, qc.nmtg_heat_number))
            used_ranges[qc.item] = existing

    def _set_in_words(self):
        self.in_words = money_in_words(
            self.grand_total,
            self.currency
        )

        self.base_in_words = money_in_words(
            self.base_grand_total,
            self.currency
        )

    def _sync_computed_fields_from_db(self):
        """
        Fix submitted document field diffs
        caused by ERPNext recalculations.
        """

        db_doc = frappe.get_doc(
            "Purchase Order",
            self.name
        )

        # Header fields
        for fieldname in self.HEADER_FALLBACK:

            if (
                not self.get(fieldname)
                and db_doc.get(fieldname)
            ):
                self.set(
                    fieldname,
                    db_doc.get(fieldname)
                )

        # Child table fields
        db_items = {
            row.name: row
            for row in db_doc.items
        }

        for row in self.items:

            db_row = db_items.get(row.name)

            if not db_row:
                continue

            for fieldname in self.ITEM_FALLBACK:

                db_val = db_row.get(fieldname)

                if db_val is not None:
                    row.set(
                        fieldname,
                        db_val
                    )