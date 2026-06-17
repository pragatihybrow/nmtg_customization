import frappe
from frappe.utils import flt
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import PurchaseReceipt


class CustomPurchaseReceipt(PurchaseReceipt):

    def validate(self):
        super().validate()
        self.validate_supplier_qc()

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
                frappe.throw(f"Item <b>{qc.item}</b> not found in Purchase Receipt.")

            if not matching_item.custom_nmtg_heat_number:
                frappe.throw(
                    f"Heat Number not generated yet for item <b>{qc.item}</b>. "
                    f"Please generate it first using the 'Create Heat Number' button."
                )

            try:
                pr_hn = matching_item.custom_nmtg_heat_number.strip()

                if " - " in pr_hn:
                    pr_start, pr_end = [
                        int(x.strip().replace("NK", ""))
                        for x in pr_hn.split(" - ")
                    ]
                else:
                    pr_num = int(pr_hn.replace("NK", "").strip())
                    pr_start, pr_end = pr_num, pr_num

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

            # ── Single heat number — just verify it matches PR item ──
            if matching_item.custom_single_heat_number:
                pr_hn_normalized = pr_hn.split(" - ")[0].strip()
                qc_hn_normalized = qc_hn.split(" - ")[0].strip()
                if qc_hn_normalized != pr_hn_normalized:
                    frappe.throw(
                        f"""
                        Heat Number does not match GRN Heat Number.<br><br>
                        GRN Heat Number: <b>{matching_item.custom_nmtg_heat_number}</b><br>
                        Entered: <b>{qc.nmtg_heat_number}</b>
                        """
                    )
                continue

            # ── Validate range inside PR item range ──
            if not (pr_start <= qc_start <= pr_end and qc_end <= pr_end):
                frappe.throw(
                    f"""
                    Heat Number range outside GRN range.<br><br>
                    GRN Range: <b>{matching_item.custom_nmtg_heat_number}</b><br>
                    Entered: <b>{qc.nmtg_heat_number}</b>
                    """
                )

            existing = used_ranges.get(qc.item, [])
            existing.sort(key=lambda x: x[0])

            # ── Overlap validation ──
            for old_start, old_end, old_range in existing:
                if qc_start <= old_end and qc_end >= old_start:
                    next_available = old_end + 1
                    expected_end = next_available + int(qc.qty) - 1
                    if expected_end > pr_end:
                        expected_end = pr_end
                    frappe.throw(
                        f"""
                        Heat Number range overlap detected.<br><br>
                        Existing Range: <b>{old_range}</b><br><br>
                        Suggested Range: <b>NK{next_available} - NK{expected_end}</b>
                        """
                    )

            # ── Qty validation ──
            calculated_qty = (qc_end - qc_start) + 1
            if flt(qc.qty) != calculated_qty:
                next_available = qc_start
                if existing:
                    max_used = max(end for _, end, _ in existing)
                    next_available = max_used + 1
                expected_end = next_available + int(qc.qty) - 1
                if expected_end > pr_end:
                    expected_end = pr_end
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