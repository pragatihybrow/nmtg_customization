import frappe

def set_customer_ref_codes(doc, method=None):
    if doc.quotation_to != "Customer" or not doc.party_name:
        return

    item_codes = list({row.item_code for row in doc.items if row.item_code})
    if not item_codes:
        return

    rows = frappe.db.get_all(
        "Item Customer Detail",
        filters={
            "parenttype": "Item",
            "parentfield": "customer_items",
            "parent": ["in", item_codes],
            "customer_name": doc.party_name,
        },
        fields=["parent as item_code", "ref_code"],
    )
    ref_code_map = {r.item_code: r.ref_code for r in rows}

    for row in doc.items:
        row.custom_customer_code = ref_code_map.get(row.item_code, "")