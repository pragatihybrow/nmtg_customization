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


def calculate_qty_in_kg(doc, method):
    for item in doc.items:
        if item.item_code and item.qty:
            conversion_factor = frappe.db.get_value(
                "UOM Conversion Detail",
                {
                    "parent": item.item_code,
                    "uom": "Kg"
                },
                "conversion_factor"
            )

            if conversion_factor:
                item.custom_qty_in_kg = item.qty * conversion_factor
            else:
                item.custom_qty_in_kg = 0


def create_inward_qty_entries(doc, method=None):
    current_row_names = {item.name for item in doc.items}

    orphaned = frappe.get_all(
        "Inward Qty",
        filters={
            "grn": doc.name,
            "source_row": ["not in", list(current_row_names) or [""]],
        },
        pluck="name",
    )
    for name in orphaned:
        frappe.delete_doc("Inward Qty", name, ignore_permissions=True)

    for item in doc.items:
        # Accepted quantity
        if not item.get("inward_qty_on_grn"):
            accepted_doc = frappe.get_doc({
                "doctype": "Inward Qty",
                "item_code": item.item_code,
                "item_name": item.item_name,
                "received_quantity": item.qty,
                "received_quantity_uom": item.uom,
                "received_quantity_in_numbers": item.get("custom_qty_in_no") or 0,
                "grn": doc.name,
                "source_row": item.name,
            }).insert(ignore_permissions=True)
            item.inward_qty_on_grn = accepted_doc.name

        # Rejected quantity, only if this row actually has any
        if item.get("rejected_qty") and not item.get("rejected_inward_qty_on_grn"):
            rejected_doc = frappe.get_doc({
                "doctype": "Inward Qty",
                "item_code": item.item_code,
                "item_name": item.item_name,
                "received_quantity": item.rejected_qty,
                "received_quantity_uom": item.uom,
                "received_quantity_in_numbers": 0,  # no equivalent source field for rejected qty in numbers
                "grn": doc.name,
                "source_row": item.name,
            }).insert(ignore_permissions=True)
            item.rejected_inward_qty_on_grn = rejected_doc.name


def remove_inward_qty_entries(doc, method=None):
    frappe.db.delete("Inward Qty", {"grn": doc.name})


def sync_qty_in_numbers_to_sle(doc, method=None):
    # Custom field must exist on Stock Ledger Entry; skip safely if it doesn't
    if not frappe.db.has_column("Stock Ledger Entry", "custom_qty_in_no"):
        frappe.log_error(
            "Custom field 'custom_qty_in_no' missing on Stock Ledger Entry; skipped sync for "
            f"{doc.name}",
            "NMTG: SLE qty in numbers sync skipped",
        )
        return

    for item in doc.items:
        # Accepted quantity
        if item.get("inward_qty_on_grn"):
            numbers = frappe.db.get_value(
                "Inward Qty", item.inward_qty_on_grn, "received_quantity_in_numbers"
            ) or 0
            _update_sle_qty_in_numbers(doc.name, item.name, item.warehouse, numbers)

        # Rejected quantity, if tracked
        if item.get("rejected_inward_qty_on_grn") and item.get("rejected_warehouse"):
            numbers = frappe.db.get_value(
                "Inward Qty", item.rejected_inward_qty_on_grn, "received_quantity_in_numbers"
            ) or 0
            _update_sle_qty_in_numbers(doc.name, item.name, item.rejected_warehouse, numbers)


def _update_sle_qty_in_numbers(voucher_no, voucher_detail_no, warehouse, numbers):
    frappe.db.sql(
        """
        UPDATE `tabStock Ledger Entry`
        SET custom_qty_in_no = CASE WHEN actual_qty < 0 THEN -%(numbers)s ELSE %(numbers)s END
        WHERE voucher_type = 'Purchase Receipt'
          AND voucher_no = %(voucher_no)s
          AND voucher_detail_no = %(voucher_detail_no)s
          AND warehouse = %(warehouse)s
        """,
        {
            "numbers": abs(numbers or 0),
            "voucher_no": voucher_no,
            "voucher_detail_no": voucher_detail_no,
            "warehouse": warehouse,
        },
    )