import frappe
from frappe.model.naming import make_autoname
from frappe.utils import today
from frappe import _
import json
import re

REMARKS_KEY = "__remarks__"


STANDARD_ITEM_FIELDS = {
    "item_code", "qty", "uom", "warehouse", "rate", "lead_time_days",
    "material_request", "material_request_item"
}

HEADER_CUSTOM_FIELDS = [
    "custom_purchase_type",
    "custom_other_purchase_type",
    "custom_rfq_nature",
    "custom_price_validity",
    "custom_warranty__guarantee",
    "custom_payment_terms",
    "custom_credit_days",
    "custom_advance_required",
    "custom_advance_required_amount",
    "custom_payment_milestone",
    "custom_retention__security_deposit_",
    "custom_retention__security_deposit_amount",
    "custom_supplier_contact_person",
    "custom_certificate_commitment"
    "custom_supplier_email",
    "custom_supplier_mobile",
    "custom_general_terms_acceptance",
    "custom_no_hidden_charges_declaration",
    "custom_quotation_correctness_declaration",
    "custom_authorized_person_name",
    "custom_designation",
    "custom__contact_number",
]


@frappe.whitelist(allow_guest=True)
def submit_supplier_quotation(data):
    if isinstance(data, str):
        data = json.loads(data)

    required = ['supplier', 'company', 'valid_till', 'rfq', 'items']
    for field in required:
        if not data.get(field):
            frappe.throw(f"Missing required field: {field}")

    rfq = frappe.get_doc("Request for Quotation", data['rfq'])
    supplier_names = [s.supplier for s in rfq.suppliers]
    if data['supplier'] not in supplier_names:
        frappe.throw("Supplier not authorized for this RFQ")

    existing = frappe.db.exists("Supplier Quotation", {
        "supplier": data['supplier'],
        "rfq": data['rfq']
    })
    if existing:
        frappe.throw(
            f"A quotation from {data['supplier']} for {data['rfq']} already exists: {existing}"
        )

    doc = frappe.new_doc("Supplier Quotation")
    doc.supplier = data['supplier']
    doc.company = data['company']
    doc.transaction_date = frappe.utils.today()
    doc.custom_submission_date_and_time = frappe.utils.now_datetime()
    doc.valid_till = data['valid_till']
    doc.rfq = data['rfq']

    if data.get('terms'):
        doc.terms = data['terms']
    if data.get('payment_terms_template'):
        doc.payment_terms_template = data['payment_terms_template']

    # ---- tax category / template ----
    if data.get('tax_category'):
        doc.tax_category = data['tax_category']
    if data.get('taxes_and_charges'):
        doc.taxes_and_charges = data['taxes_and_charges']

    # ---- header-level custom fields ----
    for fieldname in HEADER_CUSTOM_FIELDS:
        if fieldname in data:
            doc.set(fieldname, data[fieldname])

    # ---- items, including per-purchase-type custom fields ----
    for item in data['items']:
        row = {
            "item_code": item['item_code'],
            "qty": item['qty'],
            "uom": item.get('uom', 'Nos'),
            "stock_uom": item.get('uom', 'Nos'),
            "warehouse": item.get('warehouse') or rfq.set_warehouse or '',
            "rate": item['rate'],
            "lead_time_days": item.get('lead_time_days', 0),
            "material_request": item.get('material_request', ''),
            "material_request_item": item.get('material_request_item', ''),
            "request_for_quotation": data['rfq'],
        }
        for key, value in item.items():
            if key not in STANDARD_ITEM_FIELDS:
                row[key] = value

        doc.append("items", row)

    # ---- taxes and charges table ----
    for tax in data.get('taxes', []):
        doc.append("taxes", {
            "category": tax.get('category', 'Total'),
            "add_deduct_tax": tax.get('add_deduct_tax', 'Add'),
            "charge_type": tax.get('charge_type', 'On Net Total'),
            "row_id": tax.get('row_id', ''),
            "account_head": tax.get('account_head', ''),
            "description": tax.get('description', ''),
            "rate": tax.get('rate', 0),
            "tax_amount": tax.get('tax_amount', 0),
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
            "supplier_name": supplier,
            # "set_warehouse": doc.set_warehouse,
            "custom_purchase_type": getattr(doc, "custom_purchase_type", ""),
            "custom_rfq_nature": getattr(doc, "custom_rfq_nature", ""),
        },
        "items": [{
            "idx": it.idx,
            "item_code": it.item_code,
            "item_name": it.item_name,
            "item_group": it.item_group,
            "qty": it.qty,
            "uom": it.uom,
            "warehouse": it.warehouse,
            "material_request": it.material_request,
            "material_request_item": it.material_request_item,
            "custom_tds_attachment": it.custom_tds_attachment,
            "image": it.image
        } for it in doc.items]
    }




@frappe.whitelist(allow_guest=True)
def get_purchase_taxes_templates(company=None):
    """Lightweight list for the guest-page autocomplete."""
    filters = {}
    if company:
        filters["company"] = company
    return frappe.get_all(
        "Purchase Taxes and Charges Template",
        filters=filters,
        fields=["name", "tax_category", "is_default"],
        order_by="is_default desc, name asc",
        limit_page_length=0,
    )


@frappe.whitelist(allow_guest=True)
def get_taxes_template_details(template):
    """Returns the template's tax_category + its taxes rows, for populating the guest form."""
    doc = frappe.get_doc("Purchase Taxes and Charges Template", template)
    return {
        "tax_category": doc.tax_category,
        "taxes": [
            {
                "category": t.category,
                "add_deduct_tax": t.add_deduct_tax,
                "charge_type": t.charge_type,
                "account_head": t.account_head,
                "description": t.description,
                "rate": t.rate,
            }
            for t in doc.taxes
        ],
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

    valid_types = set(frappe.db.sql_list(
        "SELECT name FROM `tabQC Testing Type`"
    ))

    # Get supplier from GRN (Purchase Receipt)
    grn_supplier = frappe.db.get_value(doctype, docname, "supplier")

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
        qi.report_date = frappe.utils.today()
        qi.company = company
        qi.child_row_reference = item.get("child_row_reference", "")

        # Lab Name
        qi.custom_supplier = item.get("supplier", "")

        # Actual GRN Supplier Name
        qi.custom_supplier_name = grn_supplier

        qi.custom_nmtg_heat_number = item.get("nmtg_heat_number", "")
        qi.custom_vendor_heat_number = item.get("custom_vendor_heat_number", "")
        qi.custom_mill_tc = item.get("custom_mill_tc", "")

        testing_value = item.get("testing_value", "[]")

        try:
            testing_types = (
                json.loads(testing_value)
                if isinstance(testing_value, str)
                else (testing_value or [])
            )
        except Exception:
            testing_types = []

        for tt in testing_types:
            tt = (tt or "").strip()
            if tt and tt in valid_types:
                qi.append("custom_testing_type", {
                    "testing_type": tt
                })

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


def validate_quality_category_before_submit(doc, method):
    item_codes = list({d.item_code for d in doc.items if d.item_code})
    if not item_codes:
        return

    quality_required_map = dict(
        frappe.get_all(
            "Item",
            filters={"item_code": ["in", item_codes]},
            fields=["item_code", "custom_quality_category_required"],
            as_list=True,
        )
    )

    flagged_items = [
        row.item_code
        for row in doc.items
        if quality_required_map.get(row.item_code)
    ]

    if flagged_items and not doc.custom_quality_category:
        frappe.throw(
            _(
                "Quality Category is mandatory before submission because the "
                "following item(s) require it: {0}"
            ).format(", ".join(sorted(set(flagged_items))))
        )


@frappe.whitelist()
def custom_set_rejection_remark(name, remark):
    frappe.db.set_value("Supplier", name, "custom_rejection_remark", remark)
    frappe.db.commit()


@frappe.whitelist(allow_guest=True)
def get_supplier_request_type(supplier_name):
    if not supplier_name:
        return {}
    request_type = frappe.db.get_value("Supplier", supplier_name, "request_type")
    return {"request_type": request_type}


import json
import frappe


@frappe.whitelist(allow_guest=True)
def submit_supplier_registration():
    payload = json.loads(frappe.request.data)
    doc_data = payload.get("doc") or payload
    doc_data["doctype"] = "Supplier Registration Form"

    doc = frappe.get_doc(doc_data)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name}


@frappe.whitelist(allow_guest=True)
def get_link_options():
    doctypes = ["Country", "Supplier", "Competency"]
    result = {}
    for doctype in doctypes:
        result[doctype] = frappe.get_all(
            doctype,
            pluck="name",
            order_by="name asc",
            limit_page_length=0,
        )
    return result


@frappe.whitelist(allow_guest=True)
def upload_supplier_file():
    """
    Guest-safe file upload for the public Supplier Registration Form.
    Bypasses the core /api/method/upload_file permission check
    (which requires create permission on File, which Guest lacks)
    while still validating that a real file was posted.
    """
    if "file" not in frappe.request.files:
        frappe.throw("No file was uploaded.")

    file = frappe.request.files["file"]
    filename = file.filename
    content = file.stream.read()

    if not content:
        frappe.throw("Uploaded file is empty.")

    saved = save_file(
        fname=filename,
        content=content,
        dt=None,          # not attached to a specific doc yet — form isn't saved until submit
        dn=None,
        is_private=1,
        ignore_permissions=True,
    )

    return {"file_url": saved.file_url, "file_name": saved.file_name}


  
import base64


@frappe.whitelist(allow_guest=True)
def upload_supplier_file():
    if "file" not in frappe.request.files:
        frappe.throw("No file was uploaded.")

    file = frappe.request.files["file"]
    filename = file.filename
    content = file.stream.read()

    if not content:
        frappe.throw("Uploaded file is empty.")

    file_doc = frappe.get_doc({
        "doctype": "File",
        "file_name": filename,
        "content": base64.b64encode(content).decode("utf-8"),
        "decode": True,
        "is_private": 1,
        "attached_to_doctype": None,
        "attached_to_name": None,
    })
    file_doc.insert(ignore_permissions=True)

    return {"file_url": file_doc.file_url, "file_name": file_doc.file_name}

@frappe.whitelist(allow_guest=True)
def save_supplier_audit(doc):
    if isinstance(doc, str):
        doc = json.loads(doc)

    if doc.get("doctype") != "Supplier Audit":
        frappe.throw("Invalid doctype.")

    audit = frappe.get_doc(doc)
    audit.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": audit.name}

def validate_lead(doc, method=None):
    if doc.workflow_state != "Qualified":
        return

    missing_fields = []

    if not doc.custom_customer_type:
        missing_fields.append(_("Customer Type"))

    if not doc.custom_industry_ct:
        missing_fields.append(_("Industry"))

    # if not doc.custom_application:
    #     missing_fields.append(_("Application"))

    if not doc.custom_product_group:
        missing_fields.append(_("Product Group"))

    if missing_fields:
        frappe.throw(
            _("The following fields are mandatory before changing the Workflow State to Qualified:<br><br><b>{0}</b>").format(
                "<br>".join(f"• {field}" for field in missing_fields)
            )
        )


@frappe.whitelist()
def create_or_update_lead_contact(row, lead):
    if isinstance(row, str):
        row = json.loads(row)
    row = frappe._dict(row)
    contact_name = row.get('custom_contact_ref')

    # Validate the stored ref is still linked to this lead
    if contact_name:
        linked = frappe.db.exists("Dynamic Link", {
            "parent": contact_name,
            "parenttype": "Contact",
            "link_doctype": "Lead",
            "link_name": lead
        })
        if not linked:
            contact_name = None

    # Dedup by email, but only if that contact is already linked to this lead
    if not contact_name and row.get('email_id'):
        existing = frappe.db.sql("""
            SELECT ce.parent
            FROM `tabContact Email` ce
            INNER JOIN `tabDynamic Link` dl
                ON dl.parent = ce.parent
                AND dl.parenttype = 'Contact'
                AND dl.link_doctype = 'Lead'
                AND dl.link_name = %s
            WHERE ce.email_id = %s
            LIMIT 1
        """, (lead, row.get('email_id')))
        if existing:
            contact_name = existing[0][0]

    if contact_name and frappe.db.exists("Contact", contact_name):
        contact = frappe.get_doc("Contact", contact_name)
    else:
        contact = frappe.new_doc("Contact")

    # ensure this Lead is linked, whether contact is new or reused
    already_linked = any(
        l.link_doctype == "Lead" and l.link_name == lead
        for l in contact.get('links', [])
    )
    if not already_linked:
        contact.append('links', {
            'link_doctype': 'Lead',
            'link_name': lead
        })

    contact.first_name = row.get('name1') or contact.first_name or "Contact"
    contact.designation = row.get('designation')

    if row.get('email_id'):
        # ensure no other row is marked primary before adding/updating this one
        for e in contact.get('email_ids', []):
            e.is_primary = 0

        existing_email = next(
            (e for e in contact.get('email_ids', []) if e.email_id == row.get('email_id')),
            None
        )
        if existing_email:
            existing_email.is_primary = 1
        else:
            contact.append('email_ids', {'email_id': row.get('email_id'), 'is_primary': 1})

    if row.get('contact_no'):
        for p in contact.get('phone_nos', []):
            p.is_primary_phone = 0

        existing_phone = next(
            (p for p in contact.get('phone_nos', []) if p.phone == row.get('contact_no')),
            None
        )
        if existing_phone:
            existing_phone.is_primary_phone = 1
        else:
            contact.append('phone_nos', {'phone': row.get('contact_no'), 'is_primary_phone': 1})

    if row.get('whatsapp_no'):
        contact.custom_whatsapp_no = row.get('whatsapp_no')

    if contact.is_new():
        contact.insert(ignore_permissions=True)
    else:
        contact.save(ignore_permissions=True)

    return contact.name