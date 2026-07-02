# import json
# import re
# import frappe
# from frappe.utils import flt


# def on_submit(doc, method=None):
#     if doc.reference_type != "Purchase Receipt" or not doc.reference_name:
#         return

#     # ── Weight / MM from doc-level fields ──
#     accepted_weight = flt(doc.custom_accepted_qty_in_kg_lab)
#     rejected_weight = (
#         flt(doc.custom_rejected_qty_in_kg_lab) +
#         flt(doc.custom_total_rejected_in_kg)
#     )
#     accepted_mm = flt(doc.custom_accepted_qty_in_mm_lab)
#     rejected_mm = (
#         flt(doc.custom_rejected_qty_in_mm_lab) +
#         flt(doc.custom_total_rejected_in_mm)
#     )

#     # ── Nos count from QI qty fields ──
#     accepted_nos = int(doc.custom_total_accepted_qty or 0)
#     rejected_nos = (
#         int(doc.custom_total_rejected_qty or 0) +
#         int(getattr(doc, "custom_rejected_qtylab_", None) or 0)
#     )

#     # ── Find matching Supplier Selection For QC row ──
#     qi_heat_set = set(_parse_heat_range(doc.custom_nmtg_heat_number))

#     candidate_rows = frappe.get_all(
#         "Supplier Selection For QC",
#         filters={"parent": doc.reference_name, "item": doc.item_code},
#         fields=[
#             "name", "nmtg_heat_number",
#             "accepted_weight", "rejected_weight",
#             "accepted_in_mm", "rejected_in_mm",
#             "accepted_qty", "rejected_qty"
#         ]
#     )

#     matched_row = None
#     for row in candidate_rows:
#         row_heat_set = set(_parse_heat_range(row.nmtg_heat_number))
#         if qi_heat_set and qi_heat_set.issubset(row_heat_set):
#             matched_row = row
#             break

#     if matched_row:
#         frappe.db.set_value(
#             "Supplier Selection For QC",
#             matched_row.name,
#             {
#                 "qc":            doc.name,
#                 "accepted_weight": flt(matched_row.accepted_weight) + accepted_weight,
#                 "rejected_weight": flt(matched_row.rejected_weight) + rejected_weight,
#                 "accepted_in_mm":  flt(matched_row.accepted_in_mm)  + accepted_mm,
#                 "rejected_in_mm":  flt(matched_row.rejected_in_mm)  + rejected_mm,
#                 "accepted_qty":    int(matched_row.accepted_qty or 0) + accepted_nos,
#                 "rejected_qty":    int(matched_row.rejected_qty or 0) + rejected_nos,
#             }
#         )
#     else:
#         frappe.msgprint(
#             "No matching 'Supplier Selection For QC' row found on {0} for item {1} "
#             "covering heat numbers {2}.".format(
#                 doc.reference_name, doc.item_code, doc.custom_nmtg_heat_number
#             ),
#             indicator="orange",
#             alert=True
#         )



import json
import re
import frappe
from frappe.utils import flt, cint


def on_submit(doc, method=None):
    if doc.reference_type != "Purchase Receipt" or not doc.reference_name:
        return

    if cint(doc.custom__only_internal_qc):
        # ── Internal QC only: use the Total Accepted/Rejected fields directly ──
        accepted_weight = flt(doc.custom_total_accepted_in_kg)
        rejected_weight = flt(doc.custom_total_rejected_in_kg)
        accepted_mm = flt(doc.custom_total_accepted_in_mm)
        rejected_mm = flt(doc.custom_total_rejected_in_mm)
        accepted_nos = int(doc.custom_total_accepted_qty or 0)
        rejected_nos = int(doc.custom_total_rejected_qty or 0)
    else:
        # ── Weight / MM from doc-level lab fields ──
        accepted_weight = flt(doc.custom_accepted_qty_in_kg_lab)
        rejected_weight = (
            flt(doc.custom_rejected_qty_in_kg_lab) +
            flt(doc.custom_total_rejected_in_kg)
        )
        accepted_mm = flt(doc.custom_accepted_qty_in_mm_lab)
        rejected_mm = (
            flt(doc.custom_rejected_qty_in_mm_lab) +
            flt(doc.custom_total_rejected_in_mm)
        )

        # ── Nos count: use the lab-split fields (these are the pair that
        #    actually sums to sample_size), not custom_total_accepted_qty ──
        accepted_nos = int(doc.custom_accepted_qtylab or 0)
        rejected_nos = (
            int(doc.custom_total_rejected_qty or 0) +
            int(doc.custom_rejected_qtylab_ or 0)
        )

    # ── Find matching Supplier Selection For QC row ──
    qi_heat_set = set(_parse_heat_range(doc.custom_nmtg_heat_number))

    candidate_rows = frappe.get_all(
        "Supplier Selection For QC",
        filters={"parent": doc.reference_name, "item": doc.item_code},
        fields=[
            "name", "nmtg_heat_number",
            "accepted_weight", "rejected_weight",
            "accepted_in_mm", "rejected_in_mm",
            "accepted_qty", "rejected_qty"
        ]
    )

    matched_row = None
    for row in candidate_rows:
        row_heat_set = set(_parse_heat_range(row.nmtg_heat_number))
        if qi_heat_set and qi_heat_set.issubset(row_heat_set):
            matched_row = row
            break

    if matched_row:
        frappe.db.set_value(
            "Supplier Selection For QC",
            matched_row.name,
            {
                "qc":            doc.name,
                "accepted_weight": flt(matched_row.accepted_weight) + accepted_weight,
                "rejected_weight": flt(matched_row.rejected_weight) + rejected_weight,
                "accepted_in_mm":  flt(matched_row.accepted_in_mm)  + accepted_mm,
                "rejected_in_mm":  flt(matched_row.rejected_in_mm)  + rejected_mm,
                "accepted_qty":    int(matched_row.accepted_qty or 0) + accepted_nos,
                "rejected_qty":    int(matched_row.rejected_qty or 0) + rejected_nos,
            }
        )
    else:
        frappe.msgprint(
            "No matching 'Supplier Selection For QC' row found on {0} for item {1} "
            "covering heat numbers {2}.".format(
                doc.reference_name, doc.item_code, doc.custom_nmtg_heat_number
            ),
            indicator="orange",
            alert=True
        )


def on_cancel(doc, method=None):
    """Reverse values written on QI submit. Only triggered when QI itself is cancelled."""

    if doc.reference_type != "Purchase Receipt" or not doc.reference_name:
        return

    # Check PR is not cancelled — if PR is cancelled, child rows are already
    # zeroed by ERPNext, nothing to reverse
    pr_docstatus = frappe.db.get_value(
        "Purchase Receipt", doc.reference_name, "docstatus"
    )
    if pr_docstatus == 2:
        return

    accepted_weight = flt(doc.custom_accepted_qty_in_kg_lab)
    rejected_weight = (
        flt(doc.custom_rejected_qty_in_kg_lab) +
        flt(doc.custom_total_rejected_in_kg)
    )
    accepted_mm = flt(doc.custom_accepted_qty_in_mm_lab)
    rejected_mm = (
        flt(doc.custom_rejected_qty_in_mm_lab) +
        flt(doc.custom_total_rejected_in_mm)
    )
    accepted_nos = int(doc.custom_total_accepted_qty or 0)
    rejected_nos = (
        int(doc.custom_total_rejected_qty or 0) +
        int(getattr(doc, "custom_rejected_qtylab_", None) or 0)
    )

    qi_heat_set = set(_parse_heat_range(doc.custom_nmtg_heat_number))

    candidate_rows = frappe.get_all(
        "Supplier Selection For QC",
        filters={"parent": doc.reference_name, "item": doc.item_code},
        fields=[
            "name", "nmtg_heat_number",
            "accepted_weight", "rejected_weight",
            "accepted_in_mm", "rejected_in_mm",
            "accepted_qty", "rejected_qty"
        ]
    )

    matched_row = None
    for row in candidate_rows:
        row_heat_set = set(_parse_heat_range(row.nmtg_heat_number))
        if qi_heat_set and qi_heat_set.issubset(row_heat_set):
            matched_row = row
            break

    if matched_row:
        frappe.db.set_value(
            "Supplier Selection For QC",
            matched_row.name,
            {
                "accepted_weight": max(0, flt(matched_row.accepted_weight) - accepted_weight),
                "rejected_weight": max(0, flt(matched_row.rejected_weight) - rejected_weight),
                "accepted_in_mm":  max(0, flt(matched_row.accepted_in_mm)  - accepted_mm),
                "rejected_in_mm":  max(0, flt(matched_row.rejected_in_mm)  - rejected_mm),
                "accepted_qty":    max(0, int(matched_row.accepted_qty or 0) - accepted_nos),
                "rejected_qty":    max(0, int(matched_row.rejected_qty or 0) - rejected_nos),
            }
        )


# ─────────────────────────────────────────────────────────────────────────────
def _parse_heat_range(raw):
    if not raw:
        return []
    raw = raw.strip()
    parts = re.split(r"\s*[-\u2013\u2014]\s*", raw)
    if len(parts) != 2:
        return []

    m1 = re.match(r"^([A-Za-z]*)(\d+)$", parts[0].strip())
    m2 = re.match(r"^([A-Za-z]*)(\d+)$", parts[1].strip())
    if not m1 or not m2:
        return []

    prefix = m1.group(1)
    start = int(m1.group(2))
    end = int(m2.group(2))
    if end < start:
        return []

    pad = len(m1.group(2))
    return [f"{prefix}{str(i).zfill(pad)}" for i in range(start, end + 1)]


def _check_value_status(val, param_meta):
    if val is None or val == "":
        return None
    if param_meta.get("manual_inspection"):
        return True
    if not param_meta.get("numeric"):
        return None
    try:
        min_v = float(param_meta.get("min_value") or 0)
        max_v = float(param_meta.get("max_value") or 0)
    except (TypeError, ValueError):
        return None
    if min_v == 0 and max_v == 0:
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        return False
    return min_v <= num <= max_v


def _compute_diameter_weight(diameter, length_val):
    """Formula: Diameter(mm) * Diameter(mm) * Length(mm) * 0.000006165"""
    try:
        d = float(diameter or 0)
    except (TypeError, ValueError):
        d = 0
    if not d:
        return None
    if length_val in (None, ""):
        return None
    try:
        l_mm = float(length_val)
    except (TypeError, ValueError):
        return None
    return d * d * l_mm * 0.000006165