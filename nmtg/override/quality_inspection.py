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



# def update_purchase_receipt_qty(doc, method=None):
#     if doc.reference_type != "Purchase Receipt" or not doc.reference_name:
#         return
#     if not doc.child_row_reference:
#         return

#     pr = frappe.get_doc("Purchase Receipt", doc.reference_name)

#     if pr.docstatus != 0:
#         frappe.msgprint(
#             f"Purchase Receipt {pr.name} is not in Draft, so quantities were not updated.",
#             indicator="orange",
#             alert=True,
#         )
#         return

#     row = next((d for d in pr.items if d.name == doc.child_row_reference), None)
#     if not row:
#         frappe.msgprint(
#             f"Row {doc.child_row_reference} not found in Purchase Receipt {pr.name}.",
#             indicator="orange",
#             alert=True,
#         )
#         return

#     accepted_kg = flt(doc.custom_total_accepted_in_kg)
#     rejected_kg = flt(doc.custom_total_rejected_in_kg)

#     row.qty = accepted_kg
#     row.rejected_qty = rejected_kg
#     row.received_qty = accepted_kg + rejected_kg
#     row.custom_accepted_quantity_in_nos = flt(doc.custom_total_accepted_qty)
#     row.custom_rejected_quantity_in_nos = flt(doc.custom_total_rejected_qty)

#     pr.flags.ignore_permissions = True
#     pr.save()

HEAT_CODE_RE = re.compile(r"^NK\s*(\d+)(?:\s*-\s*NK\s*(\d+))?$", re.IGNORECASE)
SINGLE_HEAT_RE = re.compile(r"^NK\s*(\d+)$", re.IGNORECASE)


def _qi_expand_heat_numbers(text):
    """'NK553 - NK557' -> ['NK553', ..., 'NK557']; 'NK553' -> ['NK553']."""
    m = HEAT_CODE_RE.match((text or "").replace("\n", " ").strip())
    if not m:
        return []
    start = int(m.group(1))
    end = int(m.group(2)) if m.group(2) else start
    if end < start:
        return []
    return [f"NK{n}" for n in range(start, end + 1)]


def _qi_join_heat_numbers(codes):
    """['NK557','NK553','NK554'] -> 'NK553, NK554, NK557' (sorted by number)."""
    valid = [c for c in set(codes) if SINGLE_HEAT_RE.match(c)]
    valid.sort(key=lambda c: int(SINGLE_HEAT_RE.match(c).group(1)))
    return ", ".join(valid)


def _qi_get_accepted_rejected_heat_numbers(doc):
    """Work out accepted / rejected heat numbers from the Quality Inspection readings.

    A heat number is rejected when any numeric reading with a min/max range is outside that
    range (unless that heat number is approved in the reading's '__approvals__').
    Returns (accepted_codes, rejected_codes) as sets of 'NKxxx'.
    """
    all_heats = set(_qi_expand_heat_numbers(doc.get("custom_nmtg_heat_number")))
    rejected = set()

    for reading in doc.get("readings") or []:
        try:
            details = json.loads(reading.get("custom_reading_details") or "{}")
        except Exception:
            continue
        if not isinstance(details, dict):
            continue

        approvals = details.get("__approvals__") or {}
        min_value = flt(reading.get("min_value"))
        max_value = flt(reading.get("max_value"))
        check_range = bool(reading.get("numeric")) and (min_value or max_value)

        for heat, value in details.items():
            if heat.startswith("__"):
                continue

            heat = heat.replace(" ", "").upper()
            if not SINGLE_HEAT_RE.match(heat):
                continue
            all_heats.add(heat)

            if not check_range or approvals.get(heat) or value in (None, ""):
                continue

            try:
                value = flt(value)
            except Exception:
                continue

            if value < min_value or value > max_value:
                rejected.add(heat)

    return all_heats - rejected, rejected


def update_purchase_receipt_qty(doc, method=None):
    if doc.reference_type != "Purchase Receipt" or not doc.reference_name:
        return
    if not doc.child_row_reference:
        return

    pr = frappe.get_doc("Purchase Receipt", doc.reference_name)

    if pr.docstatus != 0:
        frappe.msgprint(
            f"Purchase Receipt {pr.name} is not in Draft, so quantities were not updated.",
            indicator="orange",
            alert=True,
        )
        return

    row = next((d for d in pr.items if d.name == doc.child_row_reference), None)
    if not row:
        frappe.msgprint(
            f"Row {doc.child_row_reference} not found in Purchase Receipt {pr.name}.",
            indicator="orange",
            alert=True,
        )
        return

    accepted_kg = flt(doc.custom_total_accepted_in_kg)
    rejected_kg = flt(doc.custom_total_rejected_in_kg)
    accepted_nos = flt(doc.custom_total_accepted_qty)
    rejected_nos = flt(doc.custom_total_rejected_qty)

    row.qty = accepted_kg
    row.rejected_qty = rejected_kg
    row.received_qty = accepted_kg + rejected_kg
    row.custom_accepted_quantity_in_nos = accepted_nos
    row.custom_rejected_quantity_in_nos = rejected_nos

    # ── Accepted / Rejected NMTG codes from the Quality Inspection (comma separated) ──
    accepted_codes, rejected_codes = _qi_get_accepted_rejected_heat_numbers(doc)
    all_codes = accepted_codes | rejected_codes

    if len(all_codes) == 1:
        # Single NMTG code shared by every piece: same code on both sides when both have qty
        code = next(iter(all_codes))
        row.custom_accepted_nmtg_code = code if accepted_nos > 0 else ""
        row.custom_rejected_nmtg_code = code if rejected_nos > 0 else ""
    else:
        row.custom_accepted_nmtg_code = _qi_join_heat_numbers(accepted_codes) if accepted_nos > 0 else ""
        row.custom_rejected_nmtg_code = _qi_join_heat_numbers(rejected_codes) if rejected_nos > 0 else ""

        # Safety check: the derived codes should agree with the QI totals
        if len(accepted_codes) != int(accepted_nos) or len(rejected_codes) != int(rejected_nos):
            frappe.msgprint(
                f"Quality Inspection {doc.name}: accepted/rejected NMTG codes "
                f"({len(accepted_codes)} / {len(rejected_codes)}) do not match the "
                f"accepted/rejected quantities in Nos ({int(accepted_nos)} / {int(rejected_nos)}). "
                f"Please check the NMTG codes on the Purchase Receipt row.",
                indicator="orange",
                alert=True,
            )

    pr.flags.ignore_permissions = True
    pr.save()