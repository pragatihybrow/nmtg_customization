import json
import re

import frappe
from frappe import _
from frappe.utils import flt, nowdate
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import PurchaseReceipt

HEAT_RE = re.compile(r"^NK\s*(\d+)(?:\s*-\s*NK\s*(\d+))?$", re.IGNORECASE)


def parse_heat_number(text):
   
    text = (text or "").replace("\n", " ").strip()
    m = HEAT_RE.match(text)
    if not m:
        return None
    start = int(m.group(1))
    if m.group(2) is None:
        return start, start, False
    return start, int(m.group(2)), True


def format_heat_number(start, end):
    return f"NK{start}" if start == end else f"NK{start} - NK{end}"


class CustomPurchaseReceipt(PurchaseReceipt):

    def validate(self):
        super().validate()
        self.validate_supplier_qc()

    def on_update_after_submit(self):
        # Lab rows are edited after the GRN is submitted, and validate() does not
        # run then — so the heat number rules must run here as well.
        parent = getattr(super(), "on_update_after_submit", None)
        if parent:
            parent()
        self.validate_supplier_qc()

    def validate_supplier_qc(self):
        used_ranges = {}

        for qc in self.custom_supplier_selection_for_qc or []:

            if not qc.nmtg_heat_number:
                continue

            qty = flt(qc.qty)
            if qty <= 0:
                frappe.throw(f"Row {qc.idx}: Qty must be greater than zero for item <b>{qc.item}</b>.")

            matching_item = next(
                (item for item in self.items if item.item_code == qc.item), None
            )
            if not matching_item:
                frappe.throw(f"Item <b>{qc.item}</b> not found in Purchase Receipt.")

            if not matching_item.custom_nmtg_heat_number:
                frappe.throw(
                    f"Heat Number not generated yet for item <b>{qc.item}</b>. "
                    f"Please generate it first using the 'Create Heat Number' button."
                )

            pr_parsed = parse_heat_number(matching_item.custom_nmtg_heat_number)
            if not pr_parsed:
                frappe.throw(
                    f"Invalid Heat Number on GRN item <b>{qc.item}</b>: "
                    f"<b>{matching_item.custom_nmtg_heat_number}</b>"
                )
            pr_start, pr_end, _pr_is_range = pr_parsed

            qc_parsed = parse_heat_number(qc.nmtg_heat_number)
            if not qc_parsed:
                frappe.throw(
                    f"""
                    Row {qc.idx}: Invalid Heat Number format.<br><br>
                    Expected: <b>NK5405 - NK5454</b> (qty &gt; 1) or <b>NK5833</b> (qty = 1)<br>
                    Entered: <b>{qc.nmtg_heat_number}</b>
                    """
                )
            qc_start, qc_end, is_range = qc_parsed

            # ── Range must run upward (catches NK533 - NK55) ──
            if qc_end < qc_start:
                frappe.throw(
                    f"""
                    Row {qc.idx}: Heat Number range end is smaller than its start.<br><br>
                    Entered: <b>{qc.nmtg_heat_number}</b>
                    """
                )

            # ── Single heat number item: every row must carry the GRN's one code ──
            if matching_item.custom_single_heat_number:
                if is_range or qc_start != pr_start:
                    frappe.throw(
                        f"""
                        Row {qc.idx}: Heat Number does not match GRN Heat Number.<br><br>
                        GRN Heat Number: <b>{format_heat_number(pr_start, pr_start)}</b><br>
                        Entered: <b>{qc.nmtg_heat_number}</b>
                        """
                    )
                qc.nmtg_heat_number = format_heat_number(pr_start, pr_start)
                continue

            # ── Qty 1 → exactly one NMTG code, never a range ──
            if qty == 1 and is_range:
                frappe.throw(
                    f"""
                    Row {qc.idx}: Qty is 1, so a single NMTG code is required, not a range.<br><br>
                    Entered: <b>{qc.nmtg_heat_number}</b><br>
                    Use: <b>{format_heat_number(qc_start, qc_start)}</b>
                    """
                )

            # ── Must lie inside the GRN item's range ──
            if not (pr_start <= qc_start and qc_end <= pr_end):
                frappe.throw(
                    f"""
                    Row {qc.idx}: Heat Number is outside the GRN range.<br><br>
                    GRN Range: <b>{matching_item.custom_nmtg_heat_number}</b><br>
                    Entered: <b>{qc.nmtg_heat_number}</b>
                    """
                )

            existing = sorted(used_ranges.get(qc.item, []), key=lambda x: x[0])

            # ── Overlap with earlier rows of the same item ──
            for old_start, old_end, old_text in existing:
                if qc_start <= old_end and qc_end >= old_start:
                    next_start = old_end + 1
                    next_end = min(next_start + int(qty) - 1, pr_end)
                    frappe.throw(
                        f"""
                        Row {qc.idx}: Heat Number overlaps an earlier row.<br><br>
                        Existing: <b>{old_text}</b><br>
                        Entered: <b>{qc.nmtg_heat_number}</b><br><br>
                        Suggested: <b>{format_heat_number(next_start, next_end)}</b>
                        """
                    )

            # ── Qty must equal the number of codes ──
            calculated_qty = (qc_end - qc_start) + 1
            if qty != calculated_qty:
                next_start = (max(e for _s, e, _t in existing) + 1) if existing else pr_start
                next_end = min(next_start + int(qty) - 1, pr_end)
                frappe.throw(
                    f"""
                    Row {qc.idx}: Quantity does not match Heat Number.<br><br>
                    Entered: <b>{qc.nmtg_heat_number}</b> ({calculated_qty} code(s))<br>
                    Entered Qty: <b>{qc.qty}</b><br><br>
                    Correct: <b>{format_heat_number(next_start, next_end)}</b>
                    """
                )

            # Store in canonical format (NK533 or NK533 - NK537)
            qc.nmtg_heat_number = format_heat_number(qc_start, qc_end)

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

    # Remove orphaned Inward Qty records
    orphaned = frappe.get_all(
        "Inward Qty",
        filters={
            "grn": doc.name,
            "source_row": ["not in", list(current_row_names) or [""]],
        },
        pluck="name",
    )

    for name in orphaned:
        frappe.delete_doc(
            "Inward Qty",
            name,
            ignore_permissions=True
        )

    for item in doc.items:

        # -----------------------------------------
        # Accepted quantity
        # -----------------------------------------
        if not item.get("inward_qty"):

            accepted_doc = frappe.get_doc({
                "doctype": "Inward Qty",
                "item_code": item.item_code,
                "item_name": item.item_name,
                "received_quantity": item.qty,
                "received_quantity_uom": item.uom,
                "received_quantity_in_numbers": (
                    item.get("custom_qty_in_no") or 0
                ),
                "grn": doc.name,
                "source_row": item.name,
            }).insert(ignore_permissions=True)

            # Link Inward Qty to Purchase Receipt Item
            item.inward_qty = accepted_doc.name

        # -----------------------------------------
        # Rejected quantity
        # -----------------------------------------
        if (
            item.get("rejected_qty")
            and not item.get("rejected_inward_qty")
        ):

            rejected_doc = frappe.get_doc({
                "doctype": "Inward Qty",
                "item_code": item.item_code,
                "item_name": item.item_name,
                "received_quantity": item.rejected_qty,
                "received_quantity_uom": item.uom,
                "received_quantity_in_numbers": 0,
                "grn": doc.name,
                "source_row": item.name,
            }).insert(ignore_permissions=True)

            # Link rejected Inward Qty
            item.rejected_inward_qty = rejected_doc.name


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


# ════════════════════════════════════════════════════════════════════
#  INTERNAL QC  →  standard "Quality Inspection"
# ════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def make_quality_inspections_custom(company, doctype, docname, inspection_type, items):
    """
    One standard Quality Inspection per GRN item row, for the full qty,
    identified by NMTG code only (no lab / supplier split).
    """
    if isinstance(items, str):
        items = json.loads(items)

    pr = frappe.get_doc(doctype, docname)
    pr_items = {d.name: d for d in pr.items}

    created = []

    for row in items:
        child_ref = row.get("child_row_reference")
        pr_item = pr_items.get(child_ref)
        if not pr_item:
            frappe.throw(_("Row {0} not found in {1} {2}").format(child_ref, doctype, docname))

        # One internal QI per GRN item row
        if frappe.db.exists(
            "Quality Inspection",
            {
                "reference_type": doctype,
                "reference_name": docname,
                "child_row_reference": child_ref,
                "docstatus": ["!=", 2],
            },
        ):
            continue

        qi = frappe.new_doc("Quality Inspection")
        qi.company = company
        qi.report_date = nowdate()
        qi.inspection_type = inspection_type
        qi.reference_type = doctype
        qi.reference_name = docname
        qi.child_row_reference = child_ref
        qi.item_code = pr_item.item_code
        qi.item_name = pr_item.item_name
        qi.description = pr_item.description
        qi.batch_no = pr_item.get("batch_no")
        qi.sample_size = flt(row.get("sample_size"))
        qi.inspected_by = frappe.session.user
        qi.status = "Accepted"

        # Internal QC → NMTG code only
        qi.custom_nmtg_heat_number = row.get("nmtg_heat_number") or pr_item.get("custom_nmtg_heat_number")
        qi.custom_vendor_heat_number = row.get("custom_vendor_heat_number") or pr_item.get("custom_vendor_heat_number")
        qi.custom_mill_tc = row.get("custom_mill_tc") or pr_item.get("custom_mill_tc")

        # Pull the item's QI template / readings (same as standard ERPNext behaviour)
        item_template = frappe.db.get_value("Item", pr_item.item_code, "quality_inspection_template")
        if item_template:
            qi.quality_inspection_template = item_template
            qi.get_item_specification_details()

        qi.flags.ignore_mandatory = True
        qi.insert()
        created.append(qi.name)

    return created


# ════════════════════════════════════════════════════════════════════
#  THIRD PARTY QC  →  "Third Party Quality Inspection"
# ════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def make_third_party_quality_inspections(docname):
    """
    One "Third Party Quality Inspection" per row of custom_supplier_selection_for_qc
    (lab-wise), created from a SUBMITTED GRN. Rows that already have a document are skipped.
    """
    pr = frappe.get_doc("Purchase Receipt", docname)

    if pr.docstatus != 1:
        frappe.throw(_("Third Party Quality Inspection can only be created after the GRN is submitted."))

    if pr.is_return:
        frappe.throw(_("Third Party Quality Inspection is not applicable for return GRNs."))

    if not pr.custom_supplier_selection_for_qc:
        frappe.throw(_("No lab entries found in Supplier Selection For QC."))

    pr_items = {}
    for d in pr.items:
        pr_items.setdefault(d.item_code, d)

    created, skipped = [], 0

    for qc in pr.custom_supplier_selection_for_qc:
        if frappe.db.exists(
            "Third Party Quality Inspection",
            {"grn": pr.name, "qc_row_name": qc.name, "docstatus": ["!=", 2]},
        ):
            skipped += 1
            continue

        if not qc.supplier:
            frappe.throw(_("Row {0}: Lab is mandatory.").format(qc.idx))
        if flt(qc.qty) <= 0:
            frappe.throw(_("Row {0}: Qty must be greater than zero.").format(qc.idx))

        pr_item = pr_items.get(qc.item)

        try:
            testing_types = json.loads(qc.testing_value or "[]")
        except Exception:
            testing_types = []

        doc = frappe.new_doc("Third Party Quality Inspection")
        # Testing Type (Table MultiSelect) ← types ticked on the GRN lab row
        doc.company = pr.company
        doc.report_date = nowdate()
        doc.grn = pr.name
        doc.qc_row_name = qc.name
        doc.lab_name = qc.supplier
        doc.item_code = qc.item
        doc.item_name = pr_item.item_name if pr_item else None
        doc.qty = flt(qc.qty)
        doc.nmtg_heat_number = qc.nmtg_heat_number
        doc.testing_data = ", ".join(testing_types)
        _set_testing_types(doc, testing_types)
        doc.insert()
        created.append(doc.name)

    return {"created": created, "skipped": skipped}


def _set_testing_types(doc, testing_types):
    """
    Fill the 'testing_type' Table MultiSelect (child doctype 'Testing Type CT')
    with the testing types selected in custom_supplier_selection_for_qc.
    The child's Link field and its target doctype are read from the meta, so no
    fieldname is hard-coded.
    """
    if not testing_types:
        return

    child_meta = frappe.get_meta("Testing Type CT")
    link_df = next((df for df in child_meta.fields if df.fieldtype == "Link"), None)
    if not link_df:
        frappe.throw(_("Child doctype 'Testing Type CT' has no Link field."))

    seen = set()
    for value in testing_types:
        value = (value or "").strip()
        if not value:
            continue

        # The ticked value is the 'testing_type' text of QC Testing Type;
        # resolve it to the linked record's name if they differ.
        link_name = value
        if not frappe.db.exists(link_df.options, value):
            link_name = frappe.db.get_value(link_df.options, {"testing_type": value}, "name")
            if not link_name:
                frappe.throw(
                    _("Testing Type {0} not found in {1}.").format(value, link_df.options)
                )

        if link_name in seen:
            continue
        seen.add(link_name)
        doc.append("testing_type", {link_df.fieldname: link_name})