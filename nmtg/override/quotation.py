import frappe
from frappe.utils import flt
from frappe import _
from frappe.utils import escape_html, fmt_money, formatdate, validate_email_address
from frappe.utils import cstr, now
from erpnext.selling.doctype.quotation.quotation import Quotation


class NMTGQuotation(Quotation):
    @frappe.whitelist()
    def add_note(self, note):
        self.append(
            "custom_note",
            {"note": note, "added_by": frappe.session.user, "added_on": now()},
        )
        self.save()

    @frappe.whitelist()
    def edit_note(self, note, row_id):
        for d in self.custom_note:
            if cstr(d.name) == row_id:
                d.note = note
                d.db_update()

    @frappe.whitelist()
    def delete_note(self, row_id):
        for d in self.custom_note:
            if cstr(d.name) == row_id:
                self.remove(d)
                break
        self.save()

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


@frappe.whitelist()
def update_terms_and_conditions(tc_name, terms):
    """Write edited terms from a document back to its Terms and Conditions master."""
    frappe.has_permission("Terms and Conditions", "write", throw=True)

    doc = frappe.get_doc("Terms and Conditions", tc_name)
    if (doc.terms or "") != (terms or ""):
        doc.terms = terms
        doc.save()

    return doc.name


@frappe.whitelist()
def quotation_stock_allocation(item_codes, company, quotation=None):
    frappe.has_permission("Quotation", "read", throw=True)

    if isinstance(item_codes, str):
        item_codes = [i.strip() for i in item_codes.split(",") if i.strip()]

    if not item_codes or not company:
        return []

    params = {
        "items": tuple(item_codes),
        "company": company,
        "current": quotation or "",
    }

    stock_rows = frappe.db.sql(
        """
        SELECT b.item_code, SUM(b.actual_qty) AS qty
        FROM `tabBin` b
        INNER JOIN `tabWarehouse` w ON w.name = b.warehouse
        WHERE b.item_code IN %(items)s AND w.company = %(company)s
        GROUP BY b.item_code
        """,
        params,
        as_dict=1,
    )

    qtn_rows = frappe.db.sql(
        """
        SELECT qi.item_code,
               qn.name AS quotation,
               qn.customer_name,
               qn.party_name,
               qn.transaction_date,
               qn.status,
               qn.docstatus,
               SUM(qi.stock_qty) AS qty,
               SUM(IFNULL((
                   SELECT SUM(dni.stock_qty)
                   FROM `tabSales Order Item` soi
                   INNER JOIN `tabDelivery Note Item` dni
                           ON dni.so_detail = soi.name AND dni.docstatus = 1
                   WHERE soi.quotation_item = qi.name AND soi.docstatus = 1
               ), 0)) AS delivered_qty
        FROM `tabQuotation Item` qi
        INNER JOIN `tabQuotation` qn ON qn.name = qi.parent
        WHERE qi.item_code IN %(items)s
          AND qn.company = %(company)s
          AND qn.docstatus < 2
          AND qn.name != %(current)s
          AND qn.status NOT IN ('Lost', 'Expired', 'Cancelled')
        GROUP BY qi.item_code, qn.name, qn.customer_name, qn.party_name,
                 qn.transaction_date, qn.status, qn.docstatus
        ORDER BY qn.transaction_date
        """,
        params,
        as_dict=1,
    )

    stock_map = {r.item_code: flt(r.qty) for r in stock_rows}

    qtn_map = {}
    for r in qtn_rows:
        pending = flt(r.qty) - flt(r.delivered_qty)
        if pending > 0:
            qtn_map.setdefault(r.item_code, []).append(
                {
                    "quotation": r.quotation,
                    "customer": r.customer_name or r.party_name,
                    "date": str(r.transaction_date),
                    "status": r.status,
                    "docstatus": r.docstatus,
                    "qty": flt(r.qty),
                    "pending_qty": pending,
                }
            )

    result = []
    for code in item_codes:
        quotations = qtn_map.get(code, [])
        total_pending = sum(q["pending_qty"] for q in quotations)
        in_stock = stock_map.get(code, 0)
        result.append(
            {
                "item_code": code,
                "in_stock": in_stock,
                "pending_total": total_pending,
                "available": in_stock - total_pending,
                "quotations": quotations,
            }
        )

    return result



@frappe.whitelist()
def send_quotation_to_dealer(name):
    frappe.has_permission("Quotation", ptype="email", doc=name, throw=True)

    doc = frappe.get_doc("Quotation", name)

    dealer = doc.get("custom_dealer_name")
    if not dealer:
        frappe.throw(_("No dealer is set on this quotation."))

    email = frappe.db.get_value("Customer", dealer, "email_id")
    if not email or not validate_email_address(email):
        frappe.throw(
            _("Dealer {0} does not have a valid Email ID on the Customer record.").format(
                frappe.bold(dealer)
            )
        )

    customer = doc.get("customer_name") or doc.get("party_name")

    # Items table
    rows = ""
    for idx, item in enumerate(doc.items, start=1):
        rows += (
            "<tr>"
            f"<td>{idx}</td>"
            f"<td>{escape_html(item.item_code or '')}</td>"
            f"<td>{escape_html(item.item_name or '')}</td>"
            f"<td style='text-align:right'>{item.qty}</td>"
            f"<td>{escape_html(item.uom or '')}</td>"
            f"<td style='text-align:right'>{fmt_money(item.rate, currency=doc.currency)}</td>"
            f"<td style='text-align:right'>{fmt_money(item.amount, currency=doc.currency)}</td>"
            "</tr>"
        )

    valid_till = (
        _("<p>This quotation is valid till {0}.</p>").format(formatdate(doc.valid_till))
        if doc.get("valid_till")
        else ""
    )

    message = f"""
        <p>{_("Dear")} {escape_html(dealer)},</p>
        <p>{_("Our customer")} <b>{escape_html(customer)}</b> {_("has asked for a quotation. Please find the quotation details below and the quotation PDF attached.")}</p>
        <p>
            <b>{_("Quotation No")}:</b> {escape_html(doc.name)}<br>
            <b>{_("Date")}:</b> {formatdate(doc.transaction_date)}
        </p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
            <thead>
                <tr style="background:#f3f3f3">
                    <th>#</th>
                    <th>{_("Item Code")}</th>
                    <th>{_("Item Name")}</th>
                    <th>{_("Qty")}</th>
                    <th>{_("UOM")}</th>
                    <th>{_("Rate")}</th>
                    <th>{_("Amount")}</th>
                </tr>
            </thead>
            <tbody>{rows}</tbody>
        </table>
        <p><b>{_("Grand Total")}:</b> {fmt_money(doc.grand_total, currency=doc.currency)}</p>
        {valid_till}
        <p>{_("Regards,")}<br>{escape_html(doc.company or "")}</p>
    """

    print_format = frappe.get_meta("Quotation").default_print_format or None
    attachment = frappe.attach_print(
        "Quotation",
        doc.name,
        file_name=doc.name,
        print_format=print_format,
        doc=doc,
    )

    frappe.sendmail(
        recipients=[email],
        subject=_("Quotation {0} - {1}").format(doc.name, customer),
        message=message,
        attachments=[attachment],
        reference_doctype="Quotation",
        reference_name=doc.name,
    )

    doc.add_comment(
        "Info",
        _("Quotation emailed to dealer {0} ({1})").format(dealer, email),
    )

    return email



import frappe
from frappe import _

DEALER_APPROVAL_STATE = "Sent For Dealer Approval"


def validate_dealer_remark(doc, method=None):
    before = doc.get_doc_before_save()
    old_state = before.get("workflow_state") if before else None
    new_state = doc.get("workflow_state")

    if old_state != DEALER_APPROVAL_STATE or new_state == DEALER_APPROVAL_STATE:
        return

    if not (doc.get("custom_dealer_remark") or "").strip():
        frappe.throw(
            _("Dealer Remark is mandatory to approve at the dealer approval step."),
            title=_("Missing Remark"),
        )