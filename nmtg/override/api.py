import frappe
from frappe.model.naming import make_autoname
from frappe.utils import today
import json
import re

REMARKS_KEY = "__remarks__"


@frappe.whitelist(allow_guest=True)
def submit_supplier_quotation(data):
    import json

    # Parse if string
    if isinstance(data, str):
        data = json.loads(data)

    # Basic validation
    required = ['supplier', 'company', 'valid_till', 'rfq', 'items']
    for field in required:
        if not data.get(field):
            frappe.throw(f"Missing required field: {field}")

    # Verify RFQ exists and supplier is on it
    rfq = frappe.get_doc("Request for Quotation", data['rfq'])
    supplier_names = [s.supplier for s in rfq.suppliers]
    if data['supplier'] not in supplier_names:
        frappe.throw("Supplier not authorized for this RFQ")

    # Check if quotation already submitted by this supplier
    existing = frappe.db.exists("Supplier Quotation", {
        "supplier": data['supplier'],
        "rfq": data['rfq']
    })
    if existing:
        frappe.throw(f"A quotation from {data['supplier']} for {data['rfq']} already exists: {existing}")

    doc = frappe.new_doc("Supplier Quotation")
    doc.supplier         = data['supplier']
    doc.company          = data['company']
    doc.transaction_date = frappe.utils.today()
    doc.valid_till       = data['valid_till']
    doc.rfq              = data['rfq']

    if data.get('terms'):
        doc.terms = data['terms']
    if data.get('payment_terms_template'):
        doc.payment_terms_template = data['payment_terms_template']

    for item in data['items']:
        doc.append("items", {
            "item_code":              item['item_code'],
            "qty":                    item['qty'],
            "uom":                    item.get('uom', 'Nos'),
            "stock_uom":              item.get('uom', 'Nos'),
            "warehouse":              item.get('warehouse', ''),
            "rate":                   item['rate'],
            "lead_time_days":         item.get('lead_time_days', 0),
            "material_request":       item.get('material_request', ''),
            "material_request_item":  item.get('material_request_item', ''),
            "request_for_quotation":  data['rfq']
        })

    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "status": "created"}



@frappe.whitelist(allow_guest=True)
def get_rfq_for_supplier(rfq, supplier):
    doc = frappe.get_doc("Request for Quotation", rfq)
    return {
        "rfq": {
            "name": doc.name,
            "company": doc.company,
            "transaction_date": str(doc.transaction_date),
            "schedule_date": str(doc.schedule_date),
            "supplier_name": supplier
        },
        "items": [{
            "idx": it.idx, "item_code": it.item_code,
            "item_name": it.item_name, "item_group": it.item_group,
            "qty": it.qty, "uom": it.uom, "warehouse": it.warehouse,
            "material_request": it.material_request,
            "material_request_item": it.material_request_item,
            "custom_tds_attachment": it.custom_tds_attachment,
            "image": it.image
        } for it in doc.items]
    }


@frappe.whitelist()
def create_heat_number(po, row_name):

    row = frappe.get_value(
        "Purchase Receipt Item",
        row_name,
        ["qty", "custom_qty_in_no", "custom_nmtg_heat_number", "custom_single_heat_number"],
        as_dict=True
    )

    if not row:
        frappe.throw("Row not found")

    if row.custom_nmtg_heat_number:
        frappe.throw("Heat Number already generated")

    qty = int(row.custom_qty_in_no or 0)  # ✅ use custom_qty_in_no instead of qty

    if qty <= 0:
        frappe.throw("Please set a valid Qty In No before generating Heat Number.")

    fiscal_year = frappe.db.get_value(
        "Fiscal Year",
        {
            "year_start_date": ["<=", today()],
            "year_end_date": [">=", today()],
            "disabled": 0
        },
        "name"
    )

    if not fiscal_year:
        frappe.throw("No active Fiscal Year found")

    year_initial = frappe.db.get_value(
        "Fiscal Year",
        fiscal_year,
        "custom__year_initial"
    )

    if not year_initial:
        frappe.throw(f"Year Initial missing in Fiscal Year {fiscal_year}")

    prefix = f"N{year_initial}"

    if row.custom_single_heat_number:
        single = make_autoname(f"{prefix}.###")
        num = int(single.replace(prefix, "").replace(".", ""))
        heat_number = f"{prefix}{str(num).zfill(3)}"
    else:
        first = make_autoname(f"{prefix}.###")
        start = int(first.replace(prefix, "").replace(".", ""))
        end = start

        for _ in range(qty - 1):
            nxt = make_autoname(f"{prefix}.###")
            end = int(nxt.replace(prefix, "").replace(".", ""))

        heat_number = (
            f"{prefix}{str(start).zfill(3)}"
            f" - "
            f"{prefix}{str(end).zfill(3)}"
        )

    frappe.db.set_value(
        "Purchase Receipt Item",
        row_name,
        "custom_nmtg_heat_number",
        heat_number,
        update_modified=False
    )

    return heat_number



@frappe.whitelist()
def make_quality_inspections_custom(doctype, docname, company, items, inspection_type="Incoming"):
    import json
    if isinstance(items, str):
        items = json.loads(items)

    valid_types = set(frappe.db.sql_list("SELECT name FROM `tabQC Testing Type`"))

    qi_names = []

    for item in items:
        qi = frappe.new_doc("Quality Inspection")
        qi.inspection_type = inspection_type
        qi.reference_type = doctype
        qi.reference_name = docname
        qi.item_code = item.get("item_code")
        qi.item_name = item.get("item_name")
        qi.sample_size = item.get("sample_size") or item.get("qty") or 1
        qi.inspected_by = frappe.session.user
        qi.report_date = frappe.utils.today()   # <-- was inspection_date
        qi.company = company
        qi.child_row_reference = item.get("child_row_reference", "")

        qi.custom_supplier = item.get("supplier", "")
        qi.custom_nmtg_heat_number = item.get("nmtg_heat_number", "")
        qi.custom_vendor_heat_number = item.get("custom_vendor_heat_number", "")
        qi.custom_mill_tc = item.get("custom_mill_tc", "")

        testing_value = item.get("testing_value", "[]")
        try:
            testing_types = json.loads(testing_value) if isinstance(testing_value, str) else (testing_value or [])
        except Exception:
            testing_types = []

        for tt in testing_types:
            tt = (tt or "").strip()
            if not tt or tt not in valid_types:
                continue
            qi.append("custom_testing_type", {"testing_type": tt})

        qi.insert(ignore_permissions=True)
        qi_names.append(qi.name)

    frappe.db.commit()
    return qi_names



@frappe.whitelist()
def update_qc_testing_type(row_name, testing_value):
    frappe.db.set_value(
        "Supplier Selection For QC",
        row_name,
        "testing_value",
        testing_value,
        update_modified=False
    )
    frappe.db.commit()
    return True


@frappe.whitelist()
def get_or_create_qc_series(qi_names):
    import json
    from frappe.utils import today

    if isinstance(qi_names, str):
        qi_names = json.loads(qi_names)

    # Check if all docs already share a qc_series
    existing_series = set()
    for name in qi_names:
        val = frappe.db.get_value("Quality Inspection", name, "custom_qc_series")
        if val:
            existing_series.add(val)

    # All already assigned the same series — reuse it
    if len(existing_series) == 1:
        return existing_series.pop()

    # Generate new series using fiscal year initials
    fiscal_year = frappe.db.get_value(
        "Fiscal Year",
        {
            "year_start_date": ["<=", today()],
            "year_end_date":   [">=", today()],
            "disabled": 0
        },
        "name"
    )

    if not fiscal_year:
        frappe.throw("No active Fiscal Year found")

    # Fiscal year name is like "2026-2027", extract "26-27"
    fy_short = "-".join([part[-2:] for part in fiscal_year.split("-")])

    prefix = f"N-OL-{fy_short}-"

    # Get next sequence number
    series_key = f"{prefix}.####"
    next_val = frappe.model.naming.make_autoname(series_key)
    # next_val will be like "N-OL-26-27-0001"

    # Save to all docs in this group
    for name in qi_names:
        frappe.db.set_value(
            "Quality Inspection",
            name,
            "custom_qc_series",
            next_val,
            update_modified=False
        )

    frappe.db.commit()
    return next_val


# ─────────────────────────────────────────────────────────────────────────────
# Quality Inspection row + parent status hooks
# Registered under "validate" in hooks.py, in this exact order:
#   1. compute_row_status      — recompute each reading row's status
#   2. update_parent_status    — roll row statuses up into the parent
#   3. validate_heat_range_vs_sample_size
# "validate" (not before_save) ensures this runs identically on both
# Save and Submit, after core's own doctype validate() has already run,
# so our status always has the final word.
# ─────────────────────────────────────────────────────────────────────────────

def compute_row_status(doc, method=None):
	for row in doc.get("readings", []):
		if not row.custom_reading_details:
			continue
		new_status = _compute_row_status(row)
		if new_status:
			row.status = new_status


def _compute_row_status(row):
	try:
		details = json.loads(row.custom_reading_details or "{}")
	except Exception:
		details = {}

	accepted = 0
	rejected = 0

	for key, value in details.items():
		# FIX: skip the reserved remarks blob — it is a dict, not a reading
		# value, and must never be counted toward accepted/rejected totals.
		if key == REMARKS_KEY:
			continue

		if value in (None, ""):
			continue

		if row.manual_inspection:
			accepted += 1
			continue

		if not row.numeric:
			continue

		try:
			min_v = float(row.min_value)
			max_v = float(row.max_value)
		except (TypeError, ValueError):
			continue

		if min_v == 0 and max_v == 0:
			continue

		try:
			num = float(value)
		except (TypeError, ValueError):
			rejected += 1
			continue

		if min_v <= num <= max_v:
			accepted += 1
		else:
			rejected += 1

	if accepted == 0 and rejected == 0:
		return None
	if rejected == 0:
		return "Accepted"
	if accepted == 0:
		return "Rejected"
	return "Partially Accepted"


def update_parent_status(doc, method=None):
	"""
	Server-side source of truth for the parent `status` field.
	Must run AFTER compute_row_status, so it reads the freshly
	recomputed row statuses rather than stale ones.
	"""
	statuses = [(row.status or "").strip() for row in doc.get("readings", [])]
	statuses = [s for s in statuses if s]

	if not statuses:
		return

	if all(s == "Accepted" for s in statuses):
		doc.status = "Accepted"
	elif all(s == "Rejected" for s in statuses):
		doc.status = "Rejected"
	else:
		doc.status = "Partially Accepted"


def validate_heat_range_vs_sample_size(doc, method=None):
    if doc.workflow_state != "Draft":
        return

    heat_range = (doc.custom_nmtg_heat_number or "").strip()

    if not heat_range:
        frappe.throw(
            "Please enter NMTG Heat Number before sending for Internal QC Inspection."
        )

    parts = re.split(r"\s*-\s*", heat_range)

    if len(parts) != 2:
        frappe.throw(
            f"Invalid heat number format: {heat_range}. Example: NK272 - NK281"
        )

    m1 = re.match(r'^([A-Za-z]*)(\d+)$', parts[0].strip())
    m2 = re.match(r'^([A-Za-z]*)(\d+)$', parts[1].strip())

    if not m1 or not m2:
        frappe.throw("Invalid NMTG Heat Number format.")

    start_num = int(m1.group(2))
    end_num = int(m2.group(2))

    if end_num < start_num:
        frappe.throw("End heat number cannot be smaller than start heat number.")

    heat_count = (end_num - start_num) + 1
    sample_size = doc.sample_size or 0

    if heat_count != sample_size:
        prefix = m1.group(1)
        suggested_end = start_num + sample_size - 1
        frappe.throw(
            f"Heat Range Count ({heat_count}) does not match Sample Size ({sample_size}). "
            f"For Sample Size {sample_size}, the range should be exactly "
            f"{prefix}{start_num} - {prefix}{suggested_end}."
        )