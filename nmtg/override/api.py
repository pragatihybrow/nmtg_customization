
import frappe
from frappe.model.naming import make_autoname
from frappe.utils import today

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
        "Purchase Order Item",
        row_name,
        ["qty", "custom_nmtg_heat_number"],
        as_dict=True
    )

    if not row:
        frappe.throw("Row not found")

    if row.custom_nmtg_heat_number:
        frappe.throw("Heat Number already generated")

    qty = int(row.qty)

    if qty <= 0:
        frappe.throw("Qty must be greater than 0")

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
        frappe.throw(
            f"Year Initial missing in Fiscal Year {fiscal_year}"
        )

    prefix = f"N{year_initial}"

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
        "Purchase Order Item",
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
        qi.inspection_date = frappe.utils.today()
        qi.company = company
        qi.child_row_reference = item.get("child_row_reference", "")

        # Custom fields from supplier selection for QC
        qi.custom_supplier = item.get("supplier", "")
        qi.custom_nmtg_heat_number = item.get("nmtg_heat_number", "")
        qi.custom_vendor_heat_number = item.get("custom_vendor_heat_number", "")
        qi.custom_mill_tc = item.get("custom_mill_tc", "")

        qi.insert(ignore_permissions=True)
        qi_names.append(qi.name)

    return qi_names