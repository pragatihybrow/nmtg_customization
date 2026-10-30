import frappe
from frappe.utils import flt
from erpnext.stock.doctype.stock_entry.stock_entry import StockEntry

ENDPIECE_MARKER = "Endpiece excess transfer for"


class CustomStockEntry(StockEntry):
    def _is_endpiece_return(self):
        return bool(
            self.work_order
            and self.get("job_card")
            and (self.remarks or "").startswith(ENDPIECE_MARKER)
        )

    def _run_as_plain_transfer(self, method_name):
        """Run the ERPNext method as a plain Material Transfer so the
        Work Order / Job Card quantity checks and updates are skipped,
        then restore the original values."""
        parent_method = getattr(super(), method_name, None)
        if not parent_method:
            return

        if not self._is_endpiece_return():
            return parent_method()

        original = {
            "purpose": self.purpose,
            "is_return": self.is_return,
            "job_card": self.job_card,
            "work_order": self.work_order,
        }
        self.purpose = "Material Transfer"
        self.is_return = 0
        self.job_card = None
        self.work_order = None
        try:
            return parent_method()
        finally:
            for key, value in original.items():
                self.set(key, value)

    def validate(self):
        self._run_as_plain_transfer("validate")

    def on_submit(self):
        self._run_as_plain_transfer("on_submit")

    def on_cancel(self):
        self._run_as_plain_transfer("on_cancel")


def _reset_job_card_endpiece_fields(doc):
    """Reverse the custom endpiece fields on Job Card Item rows."""
    job_card = doc.get("job_card")
    if not job_card or not (doc.remarks or "").startswith(ENDPIECE_MARKER):
        return

    for it in doc.items:
        row = frappe.db.get_value(
            "Job Card Item",
            {"parent": job_card, "item_code": it.item_code},
            ["name", "custom_endpiece_transfered_qty"],
            as_dict=True,
        )
        if not row:
            continue

        remaining = flt(row.custom_endpiece_transfered_qty) - flt(it.qty)
        if remaining > 0:
            values = {"custom_endpiece_transfered_qty": remaining}
        else:
            values = {
                "custom_endpiece_transfered": 0,
                "custom_endpiece_transfered_qty": 0,
                "custom_endpiece_transfered_warehouse": None,
            }
        frappe.db.set_value("Job Card Item", row.name, values, update_modified=False)


def on_cancel_reset(doc, method=None):
    _reset_job_card_endpiece_fields(doc)


def on_trash_reset(doc, method=None):
    # Cancelled entries were already reversed in on_cancel
    if doc.docstatus == 0:
        _reset_job_card_endpiece_fields(doc)