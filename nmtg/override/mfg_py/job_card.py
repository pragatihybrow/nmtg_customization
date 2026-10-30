import frappe
from frappe import _
from frappe.utils import flt
from erpnext.manufacturing.doctype.job_card.job_card import JobCard


class CustomJobCard(JobCard):
    def validate(self):
        super().validate()
        self.validate_single_endpiece_job_card()

    def validate_single_endpiece_job_card(self):
        if not self.custom_transfer_endpiece:
            return

        others = frappe.get_all(
            "Job Card",
            filters={
                "work_order": self.work_order,
                "custom_transfer_endpiece": 1,
                "docstatus": ["!=", 2],
                "name": ["!=", self.name or ""],
            },
            pluck="name",
        )
        if others:
            frappe.throw(
                _("Transfer Endpiece is already checked on Job Card {0} for Work Order {1}. "
                  "Only one Job Card per Work Order can have it checked.").format(others[0], self.work_order)
            )


@frappe.whitelist()
def transfer_endpiece_excess(job_card):
    jc = frappe.get_doc("Job Card", job_card)
    jc.check_permission("write")

    if jc.docstatus == 2:
        frappe.throw(_("Job Card is cancelled"))
    if not jc.custom_transfer_endpiece:
        frappe.throw(_("Transfer Endpiece is not checked on this Job Card"))
    if not jc.custom_endpiece_warehouse:
        frappe.throw(_("Please set the Endpiece Warehouse"))
    if not jc.wip_warehouse:
        frappe.throw(_("WIP Warehouse is not set on this Job Card"))

    marker = f"Endpiece excess transfer for {jc.name}"
    existing = frappe.get_all(
        "Stock Entry",
        filters={"remarks": marker, "docstatus": ["!=", 2]},
        pluck="name",
    )
    if existing:
        frappe.throw(
            _("Excess transfer already created: {0}. Cancel it first to create a new one.").format(existing[0])
        )

    rows = []
    child_updates = []  # (child row name, qty, warehouse)
    for d in jc.items:
        already = flt(d.get("custom_endpiece_transfered_qty"))
        excess = flt(d.transferred_qty) - flt(d.required_qty) - already
        if excess <= 0:
            continue

        target = jc.custom_endpiece_warehouse if excess <= 100 else d.source_warehouse
        if not target:
            frappe.throw(_("Row {0}: no Source Warehouse set for item {1}").format(d.idx, d.item_code))

        rows.append({
            "item_code": d.item_code,
            "qty": excess,
            "uom": d.uom or d.stock_uom,
            "stock_uom": d.stock_uom,
            "conversion_factor": 1,
            "transfer_qty": excess,
            "s_warehouse": jc.wip_warehouse,
            "t_warehouse": target,
        })
        child_updates.append((d.name, already + excess, target))

    if not rows:
        frappe.throw(_("No excess transferred material found on this Job Card"))

    wo = frappe.db.get_value(
        "Work Order", jc.work_order, ["bom_no", "use_multi_level_bom"], as_dict=True
    ) or {}

    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = "Material Transfer for Manufacture"
    se.purpose = "Material Transfer for Manufacture"
    se.company = jc.company
    se.work_order = jc.work_order
    se.job_card = jc.name
    se.from_bom = 1
    se.bom_no = wo.get("bom_no")
    se.use_multi_level_bom = wo.get("use_multi_level_bom") or 0
    se.fg_completed_qty = 0
    se.is_return = 1
    se.remarks = marker
    for r in rows:
        se.append("items", r)
    se.insert()

    # Update custom fields on Job Card Item rows
    for row_name, qty, warehouse in child_updates:
        frappe.db.set_value(
            "Job Card Item",
            row_name,
            {
                "custom_endpiece_transfered": 1,
                "custom_endpiece_transfered_qty": qty,
                "custom_endpiece_transfered_warehouse": warehouse,
            },
            update_modified=False,
        )

    return se.name