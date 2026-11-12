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


# ─────────────────────────────────────────────────────────────────────────────
# Conversion factor (MM per Kg) driven by the Quality Inspection
#   Accepted row : factor = accepted mm / accepted kg
#   Rejected row : factor = rejected mm / rejected kg
# ─────────────────────────────────────────────────────────────────────────────
def _qi_calc_ratio(mm, kg):
    mm = flt(mm)
    kg = flt(kg)
    if mm > 0 and kg > 0:
        return flt(mm / kg, 9)
    return 0


def _qi_find_rejected_row(pr, accepted_row, qi_name):
    """The split-off rejected row: same item + same QI, qty 0, rejected_qty > 0."""
    for d in pr.get("items") or []:
        if d.name == accepted_row.name:
            continue
        if (
            d.get("quality_inspection") == qi_name
            and d.item_code == accepted_row.item_code
            and flt(d.qty) == 0
            and flt(d.rejected_qty) > 0
        ):
            return d
    return None


def apply_qi_conversion_factor(doc, method=None):
    """Purchase Receipt before_validate: keep conversion_factor on the accepted row
    and the split rejected row in line with the submitted Quality Inspection, so
    ERPNext's standard validate recalculates stock_qty / received_stock_qty from it.

    Register in hooks.py:
        doc_events = {
            "Purchase Receipt": {
                "before_validate": "<your_module_path>.apply_qi_conversion_factor",
            },
        }
    """
    if doc.docstatus == 2:
        return

    for row in doc.get("items") or []:
        if not row.get("quality_inspection"):
            continue
        if not row.uom or not row.stock_uom or row.uom == row.stock_uom:
            continue

        qi = frappe.db.get_value(
            "Quality Inspection",
            row.quality_inspection,
            [
                "docstatus",
                "child_row_reference",
                "custom_total_accepted_in_kg",
                "custom_total_rejected_in_kg",
                "custom_total_accepted_in_mm",
                "custom_total_rejected_in_mm",
            ],
            as_dict=True,
        )
        if not qi or qi.docstatus != 1:
            continue

        if row.name == qi.child_row_reference:
            # Accepted row
            new_cf = _qi_calc_ratio(qi.custom_total_accepted_in_mm, qi.custom_total_accepted_in_kg)
            if not new_cf:
                # Nothing accepted: fall back to overall received ratio
                new_cf = _qi_calc_ratio(
                    flt(qi.custom_total_accepted_in_mm) + flt(qi.custom_total_rejected_in_mm),
                    flt(qi.custom_total_accepted_in_kg) + flt(qi.custom_total_rejected_in_kg),
                )
        elif flt(row.qty) == 0 and flt(row.rejected_qty) > 0:
            # Split rejected row
            new_cf = _qi_calc_ratio(qi.custom_total_rejected_in_mm, qi.custom_total_rejected_in_kg)
        else:
            continue

        if new_cf > 0:
            row.conversion_factor = new_cf


def _qi_restore_row_factor(row_name, cf, qty, received_qty):
    """Safety net: if anything reset the factor during save, write it back."""
    saved_cf = flt(frappe.db.get_value("Purchase Receipt Item", row_name, "conversion_factor"), 9)
    if abs(saved_cf - cf) > 0.000001:
        frappe.db.set_value(
            "Purchase Receipt Item",
            row_name,
            {
                "conversion_factor": cf,
                "stock_qty": flt(qty * cf, 3),
                "received_stock_qty": flt(received_qty * cf, 3),
            },
            update_modified=False,
        )


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
    accepted_mm = flt(doc.custom_total_accepted_in_mm)
    rejected_mm = flt(doc.custom_total_rejected_in_mm)
    accepted_nos = flt(doc.custom_total_accepted_qty)
    rejected_nos = flt(doc.custom_total_rejected_qty)

    can_convert = bool(row.uom and row.stock_uom and row.uom != row.stock_uom)

    # ── Accepted / Rejected NMTG codes from the Quality Inspection ──
    accepted_codes, rejected_codes = _qi_get_accepted_rejected_heat_numbers(doc)
    all_codes = accepted_codes | rejected_codes

    if len(all_codes) == 1:
        code = next(iter(all_codes))
        accepted_code_str = code if accepted_nos > 0 else ""
        rejected_code_str = code if rejected_nos > 0 else ""
    else:
        accepted_code_str = _qi_join_heat_numbers(accepted_codes) if accepted_nos > 0 else ""
        rejected_code_str = _qi_join_heat_numbers(rejected_codes) if rejected_nos > 0 else ""

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

    # ── ROW 1: ACCEPTED ─────────────────────────────────────────────────────
    row.qty = accepted_kg
    row.received_qty = accepted_kg
    row.rejected_qty = 0
    row.custom_accepted_quantity_in_nos = accepted_nos
    row.custom_rejected_quantity_in_nos = 0
    row.custom_accepted_nmtg_code = accepted_code_str
    row.custom_rejected_nmtg_code = ""

    acc_cf = 0
    if can_convert:
        acc_cf = _qi_calc_ratio(accepted_mm, accepted_kg)
        if not acc_cf:
            acc_cf = _qi_calc_ratio(accepted_mm + rejected_mm, accepted_kg + rejected_kg)
        if acc_cf > 0:
            row.conversion_factor = acc_cf
            row.stock_qty = flt(row.qty * acc_cf, 3)
            row.received_stock_qty = flt(row.received_qty * acc_cf, 3)

    # ── ROW 2: REJECTED (separate row so it can carry its own factor) ───────
    rej_row = _qi_find_rejected_row(pr, row, doc.name)
    rej_cf = 0

    if rejected_kg > 0:
        if not rej_row:
            data = row.as_dict()
            for key in (
                "name", "idx", "creation", "modified", "modified_by", "owner",
                "parent", "parentfield", "parenttype", "docstatus",
                # Inward Qty links belong to the accepted row; never share them
                "inward_qty", "rejected_inward_qty",
            ):
                data.pop(key, None)
            rej_row = pr.append("items", data)

        rej_row.qty = 0
        rej_row.received_qty = rejected_kg
        rej_row.rejected_qty = rejected_kg
        rej_row.rejected_warehouse = row.rejected_warehouse or pr.rejected_warehouse
        rej_row.quality_inspection = doc.name
        rej_row.custom_accepted_quantity_in_nos = 0
        rej_row.custom_rejected_quantity_in_nos = rejected_nos
        rej_row.custom_accepted_nmtg_code = ""
        rej_row.custom_rejected_nmtg_code = rejected_code_str
        # The split row must never point at the accepted row's Inward Qty
        rej_row.inward_qty = None

        if can_convert:
            rej_cf = _qi_calc_ratio(rejected_mm, rejected_kg)
            if rej_cf > 0:
                rej_row.conversion_factor = rej_cf
                rej_row.stock_qty = 0
                rej_row.received_stock_qty = flt(rejected_kg * rej_cf, 3)
    elif rej_row:
        # Nothing rejected any more: drop the split row
        pr.remove(rej_row)
        rej_row = None

    pr.flags.ignore_permissions = True
    pr.save()

    # ── Safety net: if anything reset a factor during save, write it back ──
    if acc_cf > 0:
        _qi_restore_row_factor(row.name, acc_cf, accepted_kg, accepted_kg)
    if rej_row and rej_cf > 0:
        _qi_restore_row_factor(rej_row.name, rej_cf, 0, rejected_kg)