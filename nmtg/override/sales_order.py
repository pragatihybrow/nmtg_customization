
import frappe
from frappe import _
from frappe.utils import flt, nowdate


@frappe.whitelist()
def create_so_payment_request(so, payment_term):
    """Create an (Inward) Payment Request against a Sales Order
    for the amount of the selected payment term."""

    so_doc = frappe.get_doc("Sales Order", so)

    frappe.has_permission("Sales Order", "read", doc=so_doc, throw=True)
    frappe.has_permission("Payment Request", "create", throw=True)

    if so_doc.docstatus != 1:
        frappe.throw(_("Sales Order must be submitted to create a Payment Request."))

    term_row = next(
        (row for row in so_doc.payment_schedule if row.payment_term == payment_term),
        None,
    )

    if not term_row:
        frappe.throw(
            _("Payment Term {0} not found in Sales Order {1}").format(
                frappe.bold(payment_term), so
            )
        )

    # Amount still to be requested for this term
    amount = flt(term_row.payment_amount) - flt(term_row.paid_amount)

    if amount <= 0:
        frappe.throw(
            _("Payment Term {0} is already fully paid.").format(frappe.bold(payment_term))
        )

    # Payment term can live in the standard field, the custom field, or both
    meta = frappe.get_meta("Payment Request")
    term_fields = [f for f in ("payment_term", "custom_payment_term") if meta.has_field(f)]

    # Block duplicate requests for the same term
    for fieldname in term_fields:
        existing = frappe.db.get_value(
            "Payment Request",
            {
                "reference_doctype": "Sales Order",
                "reference_name": so,
                fieldname: payment_term,
                "docstatus": ["<", 2],
            },
            "name",
        )

        if existing:
            frappe.throw(
                _("Payment Request {0} already exists for Payment Term {1}.").format(
                    frappe.bold(existing), frappe.bold(payment_term)
                )
            )

    pr = frappe.new_doc("Payment Request")
    pr.payment_request_type = "Inward"
    pr.party_type = "Customer"
    pr.party = so_doc.customer
    pr.company = so_doc.company
    pr.transaction_date = nowdate()
    pr.reference_doctype = "Sales Order"
    pr.reference_name = so_doc.name
    pr.currency = so_doc.currency
    pr.grand_total = amount
    pr.email_to = so_doc.contact_email or ""
    pr.subject = _("Payment Request for {0} - {1}").format(so_doc.name, payment_term)

    for fieldname in term_fields:
        pr.set(fieldname, payment_term)

    pr.insert()

    
    for fieldname in term_fields:
        if pr.get(fieldname) != payment_term:
            pr.db_set(fieldname, payment_term, update_modified=False)

    return pr.name