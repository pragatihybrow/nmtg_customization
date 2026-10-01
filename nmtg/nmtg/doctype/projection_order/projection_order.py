# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _


def _item_rows(doc):
    for item in doc.get("items") or []:
        po_item = item.get("custom_projection_order_item")
        if item.get("custom_projection_order") and po_item:
            yield item, po_item


def set_projection_order_reference(doc, method=None):
    for item, po_item in _item_rows(doc):
        if frappe.db.exists("Material Request Item", po_item):
            frappe.db.set_value(
                "Material Request Item",
                po_item,
                {
                    "custom_material_request": doc.name,
                    "custom_material_request_item": item.name,
                },
                update_modified=False,
            )


def clear_projection_order_reference(doc, method=None):
    for item, po_item in _item_rows(doc):
        if frappe.db.exists("Material Request Item", po_item):
            frappe.db.set_value(
                "Material Request Item",
                po_item,
                {
                    "custom_material_request": None,
                    "custom_material_request_item": None,
                },
                update_modified=False,
            )

def set_projection_order(doc, method=None):
    orders = sorted(
        {d.custom_projection_order for d in doc.get("items") if d.get("custom_projection_order")}
    )
    doc.custom_projection_order = orders[0] if orders else None

class ProjectionOrder(Document):
	pass
