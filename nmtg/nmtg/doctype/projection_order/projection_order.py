# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


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


@frappe.whitelist()
def update_projection_order_items(projection_order, items):
    """Update, add or remove item rows on a submitted Projection Order.

    `items` is a list of dicts: docname (blank for a new row), item_code, qty,
    uom, warehouse, schedule_date. Rows already linked to a Material Request
    are locked.
    """
    if isinstance(items, str):
        items = json.loads(items)

    doc = frappe.get_doc("Projection Order", projection_order)

    if not frappe.has_permission("Projection Order", "write", doc=doc):
        frappe.throw(
            _("You do not have permission to update this Projection Order"),
            frappe.PermissionError,
        )

    if doc.docstatus != 1:
        frappe.throw(_("Items can only be updated on a submitted Projection Order"))

    if not items:
        frappe.throw(_("Please add at least one item"))

    existing = {d.name: d for d in doc.get("items")}
    sent_names = {r.get("docname") for r in items if r.get("docname")}

    # ---- removed rows ----
    for name, row in list(existing.items()):
        if name in sent_names:
            continue
        if row.get("custom_material_request"):
            frappe.throw(
                _("Row #{0}: Cannot remove item {1}, it is already linked to Material Request {2}").format(
                    row.idx, frappe.bold(row.item_code), frappe.bold(row.custom_material_request)
                )
            )
        doc.remove(row)

    # ---- updated / new rows ----
    for idx, r in enumerate(items, start=1):
        qty = flt(r.get("qty"))
        if qty <= 0:
            frappe.throw(_("Row #{0}: Quantity must be greater than zero").format(idx))

        docname = r.get("docname")

        if docname:
            row = existing.get(docname)
            if not row:
                frappe.throw(_("Row #{0}: Item row {1} was not found").format(idx, docname))

            new_uom = r.get("uom") or row.uom
            new_wh = r.get("warehouse") or row.warehouse
            new_date = r.get("schedule_date") or row.schedule_date

            changed = (
                flt(row.qty) != qty
                or (row.uom or "") != (new_uom or "")
                or (row.warehouse or "") != (new_wh or "")
                or str(row.schedule_date or "") != str(new_date or "")
            )

            if changed and row.get("custom_material_request"):
                frappe.throw(
                    _(
                        "Row #{0}: Item {1} is already linked to Material Request {2} and cannot be changed"
                    ).format(
                        row.idx, frappe.bold(row.item_code), frappe.bold(row.custom_material_request)
                    )
                )

            if not changed:
                continue

            row.qty = qty
            if new_uom != row.uom:
                row.uom = new_uom
                row.conversion_factor = _get_conversion_factor(
                    row.item_code, new_uom, row.stock_uom
                )
            row.warehouse = new_wh
            row.schedule_date = new_date
        else:
            item_code = r.get("item_code")
            if not item_code:
                frappe.throw(_("Row #{0}: Item Code is required").format(idx))

            item = frappe.db.get_value(
                "Item",
                item_code,
                ["item_name", "description", "item_group", "brand", "image", "stock_uom"],
                as_dict=True,
            )
            if not item:
                frappe.throw(_("Row #{0}: Item {1} does not exist").format(idx, item_code))

            uom = r.get("uom") or item.stock_uom
            schedule_date = r.get("schedule_date") or doc.schedule_date
            if not schedule_date:
                frappe.throw(_("Row #{0}: Required By date is required").format(idx))

            row = doc.append(
                "items",
                {
                    "item_code": item_code,
                    "item_name": item.item_name,
                    "description": item.description,
                    "item_group": item.item_group,
                    "brand": item.brand,
                    "image": item.image,
                    "qty": qty,
                    "uom": uom,
                    "stock_uom": item.stock_uom,
                    "conversion_factor": _get_conversion_factor(item_code, uom, item.stock_uom),
                    "warehouse": r.get("warehouse") or doc.warehouse,
                    "schedule_date": schedule_date,
                },
            )

        row.stock_qty = flt(flt(row.qty) * (flt(row.conversion_factor) or 1), 9)
        row.amount = flt(row.qty) * flt(row.get("rate"))

    for i, d in enumerate(doc.get("items"), start=1):
        d.idx = i

    doc.flags.ignore_validate_update_after_submit = True
    doc.save()

    return doc.name


def _get_conversion_factor(item_code, uom, stock_uom):
    if not uom or uom == stock_uom:
        return 1

    factor = frappe.db.get_value(
        "UOM Conversion Detail", {"parent": item_code, "uom": uom}, "conversion_factor"
    )
    if not factor:
        frappe.throw(
            _("UOM Conversion factor for {0} is not defined on Item {1}").format(
                frappe.bold(uom), frappe.bold(item_code)
            )
        )
    return flt(factor)
