import frappe

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