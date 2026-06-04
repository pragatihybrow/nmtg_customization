import frappe
from erpnext.stock.doctype.material_request.material_request import make_request_for_quotation

@frappe.whitelist()
def make_rfq_with_suppliers(source_name):
    rfq = make_request_for_quotation(source_name)

    supplier_set = set()

    for item in rfq.items:
        if not item.item_code:
            continue

        item_suppliers = frappe.get_all(
            "Item Supplier",
            filters={"parent": item.item_code},
            fields=["supplier"]
        )
        for row in item_suppliers:
            if row.supplier:
                supplier_set.add(row.supplier)

    existing_suppliers = {d.supplier for d in rfq.suppliers if d.supplier}
    supplier_set.update(existing_suppliers)

    # Fetch email for each supplier — prefer primary contact email, fall back to supplier email_id
    def get_supplier_email(supplier):
        # 1. Try the primary contact linked on the supplier
        primary_contact = frappe.db.get_value("Supplier", supplier, "supplier_primary_contact")
        if primary_contact:
            email = frappe.db.get_value("Contact", primary_contact, "email_id")
            if email:
                return email

        # 2. Fall back to email_id directly on the Supplier doc
        return frappe.db.get_value("Supplier", supplier, "email_id") or ""

    rfq.suppliers = []
    for supplier in sorted(supplier_set):
        rfq.append("suppliers", {
            "supplier": supplier,
            "quote_status": "Pending",
            "send_email": 1,
            "email_sent": 0,
            "email_id": get_supplier_email(supplier),  # ✅ populate the email_id field
        })

    return rfq