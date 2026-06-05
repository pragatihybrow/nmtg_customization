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