import frappe
from frappe.utils import nowdate, flt
from erpnext.accounts.doctype.payment_request import payment_request as std_payment_request
from erpnext.accounts.doctype.payment_request.payment_request import PaymentRequest


PRINT_FORMAT = "Proforma Invoice With Payment Term"


class CustomPaymentRequest(PaymentRequest):
    def send_email(self):
        # Inward requests against a Sales Order get only the Proforma mail
        # (sent from the on_submit hook), so skip the standard email.
        if _should_send_proforma(self):
            return
        return super().send_email()


@frappe.whitelist()
def create_po_payment_request(po, payment_term):
    if not po or not payment_term:
        frappe.throw("Purchase Order and Payment Term are required.")

    po_doc = frappe.get_doc("Purchase Order", po)

    if po_doc.docstatus != 1:
        frappe.throw("Purchase Order must be submitted.")

    row = None
    for d in po_doc.payment_schedule:
        if d.payment_term == payment_term:
            row = d
            break

    if not row:
        frappe.throw(
            "Payment Term {0} is not in Purchase Order {1}.".format(payment_term, po)
        )

    pr = frappe.new_doc("Payment Request")
    pr.payment_request_type = "Outward"
    pr.transaction_date = nowdate()
    pr.company = po_doc.company
    pr.party_type = "Supplier"
    pr.party = po_doc.supplier
    pr.reference_doctype = "Purchase Order"
    pr.reference_name = po_doc.name
    pr.currency = po_doc.currency
    pr.grand_total = row.payment_amount
    pr.email_to = po_doc.contact_email
    pr.subject = "Payment Request for {0}".format(po_doc.name)
    pr.custom_payment_term = payment_term

    # Items table (shown only for "Before Dispatch" terms)
    if "Before Dispatch" in payment_term:
        already = get_already_requested(po_doc.name, payment_term, "Purchase Order")

        po_items = {}
        for it in po_doc.items:
            if it.item_code not in po_items:
                po_items[it.item_code] = {"item_name": it.item_name, "qty": 0}
            po_items[it.item_code]["qty"] += it.qty or 0

        for item_code, data in po_items.items():
            remaining = data["qty"] - already.get(item_code, 0)
            pr.append("custom_items", {
                "item_code": item_code,
                "item_name": data["item_name"],
                "po_qty": data["qty"],
                "before_dispatch_ready_qty": remaining if remaining > 0 else 0,
            })

    pr.insert()

    return pr.name


@frappe.whitelist()
def create_so_payment_request(so, payment_term):
    """Inward Payment Request against a Sales Order for the selected payment term."""
    if not so or not payment_term:
        frappe.throw("Sales Order and Payment Term are required.")

    so_doc = frappe.get_doc("Sales Order", so)

    if so_doc.docstatus != 1:
        frappe.throw("Sales Order must be submitted.")

    row = None
    for d in so_doc.payment_schedule:
        if d.payment_term == payment_term:
            row = d
            break

    if not row:
        frappe.throw(
            "Payment Term {0} is not in Sales Order {1}.".format(payment_term, so)
        )

    pr = frappe.new_doc("Payment Request")
    pr.payment_request_type = "Inward"
    pr.transaction_date = nowdate()
    pr.company = so_doc.company
    pr.party_type = "Customer"
    pr.party = so_doc.customer
    pr.reference_doctype = "Sales Order"
    pr.reference_name = so_doc.name
    pr.currency = so_doc.currency
    pr.grand_total = row.payment_amount
    pr.email_to = so_doc.contact_email
    pr.subject = "Payment Request for {0} - {1}".format(so_doc.name, payment_term)
    pr.custom_payment_term = payment_term

    # Items table (shown only for "Before Dispatch" terms)
    if "Before Dispatch" in payment_term:
        already = get_already_requested(so_doc.name, payment_term, "Sales Order")

        so_items = {}
        for it in so_doc.items:
            if it.item_code not in so_items:
                so_items[it.item_code] = {"item_name": it.item_name, "qty": 0}
            so_items[it.item_code]["qty"] += it.qty or 0

        for item_code, data in so_items.items():
            remaining = data["qty"] - already.get(item_code, 0)
            pr.append("custom_items", {
                "item_code": item_code,
                "item_name": data["item_name"],
                "po_qty": data["qty"],
                "before_dispatch_ready_qty": remaining if remaining > 0 else 0,
            })

    pr.insert()

    return pr.name


@frappe.whitelist()
def create_pi_payment_request(pi, po, payment_term):
    """Payment Request against a Purchase Invoice, with the payment term taken from its PO."""
    if not pi or not po or not payment_term:
        frappe.throw("Purchase Invoice, Purchase Order and Payment Term are required.")

    pi_doc = frappe.get_doc("Purchase Invoice", pi)
    if pi_doc.docstatus != 1:
        frappe.throw("Purchase Invoice must be submitted.")

    if po not in {i.purchase_order for i in pi_doc.items if i.purchase_order}:
        frappe.throw("Purchase Order {0} is not linked to Purchase Invoice {1}.".format(po, pi))

    po_doc = frappe.get_doc("Purchase Order", po)
    row = None
    for d in po_doc.payment_schedule:
        if d.payment_term == payment_term:
            row = d
            break

    if not row:
        frappe.throw(
            "Payment Term {0} is not in Purchase Order {1}.".format(payment_term, po)
        )

    # Amount already requested for this PO term (against the PO or this invoice)
    requested = 0
    for ref_dt, ref_dn in (("Purchase Order", po), ("Purchase Invoice", pi)):
        for r in frappe.get_all(
            "Payment Request",
            filters={
                "reference_doctype": ref_dt,
                "reference_name": ref_dn,
                "custom_payment_term": payment_term,
                "docstatus": ["<", 2],
                "status": ["not in", ["Cancelled", "Failed"]],
            },
            fields=["grand_total"],
        ):
            requested += flt(r.grand_total)

    remaining_term = flt(row.payment_amount) - requested
    amount = min(remaining_term, flt(pi_doc.outstanding_amount))

    if amount <= 0:
        frappe.throw(
            "Nothing left to request for {0} (term remaining {1}, invoice outstanding {2}).".format(
                payment_term, remaining_term, pi_doc.outstanding_amount
            )
        )

    pr = frappe.new_doc("Payment Request")
    pr.payment_request_type = "Outward"
    pr.transaction_date = nowdate()
    pr.company = pi_doc.company
    pr.party_type = "Supplier"
    pr.party = pi_doc.supplier
    pr.reference_doctype = "Purchase Invoice"
    pr.reference_name = pi_doc.name
    pr.currency = pi_doc.currency
    pr.grand_total = amount
    pr.email_to = pi_doc.contact_email
    pr.subject = "Payment Request for {0}".format(pi_doc.name)
    pr.custom_payment_term = payment_term
    pr.insert()

    return pr.name


@frappe.whitelist()
def create_si_payment_request(si, so, payment_term):
    """Inward Payment Request against a Sales Invoice, with the payment term taken from its SO."""
    if not si or not so or not payment_term:
        frappe.throw("Sales Invoice, Sales Order and Payment Term are required.")

    si_doc = frappe.get_doc("Sales Invoice", si)
    if si_doc.docstatus != 1:
        frappe.throw("Sales Invoice must be submitted.")

    if so not in {i.sales_order for i in si_doc.items if i.sales_order}:
        frappe.throw("Sales Order {0} is not linked to Sales Invoice {1}.".format(so, si))

    so_doc = frappe.get_doc("Sales Order", so)
    row = None
    for d in so_doc.payment_schedule:
        if d.payment_term == payment_term:
            row = d
            break

    if not row:
        frappe.throw(
            "Payment Term {0} is not in Sales Order {1}.".format(payment_term, so)
        )

    # Amount already requested for this SO term (against the SO or this invoice)
    requested = 0
    for ref_dt, ref_dn in (("Sales Order", so), ("Sales Invoice", si)):
        for r in frappe.get_all(
            "Payment Request",
            filters={
                "reference_doctype": ref_dt,
                "reference_name": ref_dn,
                "custom_payment_term": payment_term,
                "docstatus": ["<", 2],
                "status": ["not in", ["Cancelled", "Failed"]],
            },
            fields=["grand_total"],
        ):
            requested += flt(r.grand_total)

    remaining_term = flt(row.payment_amount) - requested
    amount = min(remaining_term, flt(si_doc.outstanding_amount))

    if amount <= 0:
        frappe.throw(
            "Nothing left to request for {0} (term remaining {1}, invoice outstanding {2}).".format(
                payment_term, remaining_term, si_doc.outstanding_amount
            )
        )

    pr = frappe.new_doc("Payment Request")
    pr.payment_request_type = "Inward"
    pr.transaction_date = nowdate()
    pr.company = si_doc.company
    pr.party_type = "Customer"
    pr.party = si_doc.customer
    pr.reference_doctype = "Sales Invoice"
    pr.reference_name = si_doc.name
    pr.currency = si_doc.currency
    pr.grand_total = amount
    pr.email_to = si_doc.contact_email
    pr.subject = "Payment Request for {0}".format(si_doc.name)
    pr.custom_payment_term = payment_term
    pr.insert()

    return pr.name


def get_already_requested(order_name, payment_term, reference_doctype="Purchase Order"):
    """Ready qty per item across active Payment Requests of the same order and term."""
    requests = frappe.get_all(
        "Payment Request",
        filters={
            "reference_doctype": reference_doctype,
            "reference_name": order_name,
            "custom_payment_term": payment_term,
            "docstatus": ["<", 2],
        },
        pluck="name",
    )

    result = {}
    if requests:
        rows = frappe.get_all(
            "Payment Request CT",
            filters={"parent": ["in", requests], "parenttype": "Payment Request"},
            fields=["item_code", "before_dispatch_ready_qty"],
        )
        for r in rows:
            result[r.item_code] = result.get(r.item_code, 0) + (r.before_dispatch_ready_qty or 0)

    return result


@frappe.whitelist()
def make_payment_request(**args):
    """Optional override of the standard method (only used with the hooks.py entry)."""
    args = frappe._dict(args)

    if args.dt == "Purchase Order" and args.payment_term:
        return create_po_payment_request(args.dn, args.payment_term)

    if args.dt == "Sales Order" and args.payment_term:
        return create_so_payment_request(args.dn, args.payment_term)

    return std_payment_request.make_payment_request(**args)


def _should_send_proforma(doc):
    if doc.payment_request_type != "Inward":
        return False
    if doc.reference_doctype != "Sales Order":
        return False
    if not doc.email_to or doc.mute_email:
        return False
    return bool(
        frappe.db.exists("Print Format", {"name": PRINT_FORMAT, "doc_type": "Payment Request"})
    )


def send_proforma_invoice_email(doc, method=None):
    if doc.payment_request_type != "Inward":
        return
    if doc.reference_doctype != "Sales Order":
        return
    if not doc.email_to or doc.mute_email:
        return

    if not frappe.db.exists("Print Format", {"name": PRINT_FORMAT, "doc_type": "Payment Request"}):
        frappe.msgprint(
            "Print Format '{0}' not found for Payment Request. Email not sent.".format(PRINT_FORMAT),
            indicator="orange",
        )
        return

    try:
        frappe.sendmail(
            recipients=[doc.email_to],
            subject=doc.subject or doc.name,
            message=doc.message or "",
            reference_doctype=doc.doctype,
            reference_name=doc.name,
            attachments=[{
                "print_format_attachment": 1,
                "doctype": doc.doctype,
                "name": doc.name,
                "print_format": PRINT_FORMAT,
                "lang": "en",
            }],
        )
    except Exception:
        # Never block the submit because of an email problem
        frappe.log_error(title="Proforma Invoice email failed for " + doc.name)
        frappe.msgprint(
            "Payment Request submitted, but the email could not be queued. Check the Error Log.",
            indicator="red",
        )