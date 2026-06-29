
import json
import re
import frappe
from frappe.utils import flt
 

def on_submit(doc, method=None):
    params = []
    value_map = {}
    for row in doc.readings:
        spec = (row.specification or "").strip()
        if not spec or spec in value_map:
            continue
        try:
            details = json.loads(row.custom_reading_details or "{}")
        except ValueError:
            details = {}
        details.pop("__remarks__", None)
        value_map[spec] = details
        params.append({
            "spec": spec,
            "numeric": row.numeric,
            "min_value": row.min_value,
            "max_value": row.max_value,
            "manual_inspection": row.manual_inspection
        })

    length_spec = next((p["spec"] for p in params if p["spec"].lower() == "length"), None)
    length_map = value_map.get(length_spec, {}) if length_spec else {}

    diameter = frappe.db.get_value("Item", doc.item_code, "custom_diameter")

    heat_numbers = _parse_heat_range(doc.custom_nmtg_heat_number)

    # ---------------------------------------------------------------------------
    # Use doc-level lab + field values instead of re-computing from heat numbers
    # ---------------------------------------------------------------------------
    accepted_weight = flt(doc.custom_accepted_qty_in_kg_lab)
    rejected_weight = flt(doc.custom_rejected_qty_in_kg_lab) + flt(doc.custom_total_rejected_in_kg)
    accepted_mm     = flt(doc.custom_accepted_qty_in_mm_lab)
    rejected_mm     = flt(doc.custom_rejected_qty_in_mm_lab) + flt(doc.custom_total_rejected_in_mm)

    if doc.reference_type != "Purchase Receipt" or not doc.reference_name:
        return

    qi_heat_set = set(heat_numbers)

    candidate_rows = frappe.get_all(
        "Supplier Selection For QC",
        filters={"parent": doc.reference_name, "item": doc.item_code},
        fields=["name", "nmtg_heat_number", "accepted_weight", "rejected_weight",
                "accepted_in_mm", "rejected_in_mm"]
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
                "qc": doc.name,
                "accepted_weight": (flt(matched_row.accepted_weight) or 0) + accepted_weight,
                "rejected_weight": (flt(matched_row.rejected_weight) or 0) + rejected_weight,
                "accepted_in_mm":  (flt(matched_row.accepted_in_mm)  or 0) + accepted_mm,
                "rejected_in_mm":  (flt(matched_row.rejected_in_mm)  or 0) + rejected_mm,
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

# ─────────────────────────────────────────────────────────────────────────────
# Mirrors parse_heat_range() in the client script
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
 
 
# ─────────────────────────────────────────────────────────────────────────────
# Mirrors check_value_status() in the client script
# ─────────────────────────────────────────────────────────────────────────────
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
 
 
# ─────────────────────────────────────────────────────────────────────────────
# Mirrors compute_diameter_weight() in the client script
# ─────────────────────────────────────────────────────────────────────────────
def _compute_diameter_weight(diameter, length_val):
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
    l_m = l_mm / 1000.0
    return (d * d * l_m) / 162
 