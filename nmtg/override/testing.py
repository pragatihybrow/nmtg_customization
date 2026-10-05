# Test-data generator for the "Sales Target Achievement" report.
# Customers: Palmer Productions Ltd. (Pragati) and R Enterprice (Aanshi).
# Every document is tagged "TEST-" so cleanup() can remove it.
#
# Run from the bench folder:
#   bench --site <site> execute nmtg.override.testing.baseline
#   bench --site <site> execute nmtg.override.testing.factor_1
#   ... factor_2 to factor_6 (factors 7, 8 and 9 reuse this data) ...
#   bench --site <site> execute nmtg.override.testing.run_all
#   bench --site <site> execute nmtg.override.testing.cleanup

import time

import frappe
from frappe.utils import add_days

PALMER = "Palmer Productions Ltd."  # sales person: Pragati
RENT = "R Enterprice"               # sales person: Aanshi

# The nmtg Item override blocks creating new items without Item Settings,
# so this script reuses an existing item. Set a code here to pin one,
# or leave None to auto-pick an existing sales item.
TEST_ITEM = None

_CTX = {}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _ctx():
    if not _CTX:
        frappe.set_user("Administrator")
        company = frappe.defaults.get_global_default("company")

        item = TEST_ITEM
        if not item:
            base = {"disabled": 0, "is_sales_item": 1, "has_variants": 0}
            item = (
                frappe.db.get_value("Item", {**base, "is_stock_item": 0}, "name")
                or frappe.db.get_value("Item", base, "name")
            )
        if not item:
            frappe.throw("No sales item found. Set TEST_ITEM at the top of testing.py.")

        is_stock = frappe.db.get_value("Item", item, "is_stock_item")
        warehouse = None
        if is_stock:
            warehouse = frappe.db.get_value(
                "Warehouse", {"company": company, "is_group": 0, "disabled": 0}, "name")

        _CTX.update(
            company=company,
            cmp=frappe.get_doc("Company", company),
            price_list=frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name"),
            item=item,
            warehouse=warehouse,
        )
        print("Using item:", item, "| warehouse:", warehouse)
    return frappe._dict(_CTX)


def _row(qty, rate, **extra):
    """One item row for any selling document."""
    c = _ctx()
    row = {"item_code": c.item, "qty": qty, "rate": rate}
    if c.warehouse:
        row["warehouse"] = c.warehouse
    row.update(extra)
    return row


def _get(doctype, field, value):
    name = frappe.db.get_value(doctype, {field: value}, "name")
    return frappe.get_doc(doctype, name) if name else None


def _so(customer, date, qty, rate, tag):
    existing = _get("Sales Order", "po_no", tag)
    if existing:
        return existing, False
    c = _ctx()
    so = frappe.get_doc({
        "doctype": "Sales Order", "customer": customer, "company": c.company,
        "transaction_date": date, "delivery_date": add_days(date, 15),
        "currency": c.cmp.default_currency, "selling_price_list": c.price_list,
        "po_no": tag,
        "items": [_row(qty, rate, delivery_date=add_days(date, 15))],
    })
    so.insert(ignore_permissions=True)
    so.submit()
    return so, True


def _so_from_quotation(q_name, date, tag):
    existing = _get("Sales Order", "po_no", tag)
    if existing:
        return existing
    from erpnext.selling.doctype.quotation.quotation import make_sales_order
    so = make_sales_order(q_name)
    so.transaction_date = date
    so.delivery_date = add_days(date, 15)
    for it in so.items:
        it.delivery_date = so.delivery_date
    so.po_no = tag
    so.insert(ignore_permissions=True)
    so.submit()
    return so


def _si_from_so(so_name, date, tag):
    existing = _get("Sales Invoice", "po_no", tag)
    if existing:
        return existing
    from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
    si = make_sales_invoice(so_name)
    si.set_posting_time = 1
    si.posting_date = date
    si.due_date = add_days(date, 30)
    si.update_stock = 0
    si.po_no = tag
    si.insert(ignore_permissions=True)
    si.submit()
    return si


def _si_direct(customer, date, due, qty, rate, tag):
    existing = _get("Sales Invoice", "po_no", tag)
    if existing:
        return existing
    c = _ctx()
    si = frappe.get_doc({
        "doctype": "Sales Invoice", "customer": customer, "company": c.company,
        "set_posting_time": 1, "posting_date": date, "due_date": due,
        "update_stock": 0,
        "currency": c.cmp.default_currency, "selling_price_list": c.price_list,
        "debit_to": c.cmp.default_receivable_account, "po_no": tag,
        "items": [_row(qty, rate,
                       income_account=c.cmp.default_income_account,
                       cost_center=c.cmp.cost_center)],
    })
    si.insert(ignore_permissions=True)
    si.submit()
    return si


def _payment(si_name, date, amount, tag):
    existing = _get("Payment Entry", "reference_no", tag)
    if existing:
        return existing
    c = _ctx()
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    pe = get_payment_entry("Sales Invoice", si_name, party_amount=amount)
    pe.posting_date = date
    pe.reference_no = tag
    pe.reference_date = date
    if not pe.paid_to:
        pe.paid_to = frappe.db.get_value(
            "Account", {"company": c.company, "account_type": "Cash", "is_group": 0}, "name")
    pe.insert(ignore_permissions=True)
    pe.submit()
    return pe


def _opportunity(customer, date, tag):
    existing = _get("Opportunity", "title", tag)
    if existing:
        return existing
    c = _ctx()
    opp = frappe.get_doc({
        "doctype": "Opportunity", "opportunity_from": "Customer", "party_name": customer,
        "company": c.company, "transaction_date": date, "title": tag,
    })
    opp.insert(ignore_permissions=True)
    return opp


def _quotation(opp, date, qty, rate, tag):
    existing = _get("Quotation", "title", tag)
    if existing:
        return existing
    c = _ctx()
    q = frappe.get_doc({
        "doctype": "Quotation", "quotation_to": "Customer", "party_name": opp.party_name,
        "company": c.company, "transaction_date": date, "valid_till": add_days(date, 30),
        "opportunity": opp.name, "title": tag, "order_type": "Sales",
        "currency": c.cmp.default_currency, "selling_price_list": c.price_list,
        "items": [_row(qty, rate)],
    })
    q.insert(ignore_permissions=True)
    q.submit()
    return q


def _todo(ref_type, ref_name, due, tag):
    _ctx()
    td = frappe.get_doc({
        "doctype": "ToDo", "reference_type": ref_type, "reference_name": ref_name,
        "allocated_to": "Administrator", "date": due, "description": tag, "status": "Open",
    })
    td.insert(ignore_permissions=True)
    return td


def _lead(first_name, email):
    existing = _get("Lead", "email_id", email)
    if existing:
        return existing
    c = _ctx()
    ld = frappe.get_doc({
        "doctype": "Lead", "first_name": first_name, "company_name": first_name + " Co",
        "email_id": email, "company": c.company,
    })
    ld.insert(ignore_permissions=True)
    return ld


# --------------------------------------------------------------------------
# Baseline: what already exists for the two customers
# --------------------------------------------------------------------------
def baseline():
    _ctx()
    for c in (PALMER, RENT):
        print(
            c,
            "| submitted SO:", frappe.db.count("Sales Order", {"customer": c, "docstatus": 1}),
            "| submitted SI:", frappe.db.count("Sales Invoice", {"customer": c, "docstatus": 1}),
            "| lead_name:", frappe.db.get_value("Customer", c, "lead_name"),
        )


# --------------------------------------------------------------------------
# Factor 1: Net Sales Order Value
# Pragati +300, Aanshi +300 (cancelled and September orders are not counted)
# --------------------------------------------------------------------------
def factor_1():
    _ctx()
    _so(PALMER, "2026-10-02", 3, 100, "TEST-P1")           # 300
    so, created = _so(PALMER, "2026-10-03", 1, 50, "TEST-P3")
    if created:
        so.cancel()                                          # cancelled: excluded
    _so(PALMER, "2026-09-15", 1, 100, "TEST-P0")            # September: out of period
    _so(RENT, "2026-10-03", 2, 100, "TEST-R1")              # 200
    _so(RENT, "2026-10-04", 1, 100, "TEST-R2")              # 100
    frappe.db.commit()
    print("Factor 1 done")


# --------------------------------------------------------------------------
# Factor 2: Overdue Collection
# Pragati +100, Aanshi +30 (the invoice that is not yet due is excluded)
# --------------------------------------------------------------------------
def factor_2():
    _ctx()
    s1 = _si_direct(PALMER, "2026-08-15", "2026-09-15", 1, 100, "TEST-PS1")  # overdue
    s2 = _si_direct(RENT, "2026-08-20", "2026-09-20", 1, 80, "TEST-RS1")     # overdue
    s3 = _si_direct(RENT, "2026-09-01", "2026-12-01", 1, 50, "TEST-RS2")     # not due yet
    _payment(s1.name, "2026-10-03", 100, "TEST-PE1")   # counts: 100
    _payment(s2.name, "2026-10-04", 30, "TEST-PE2")    # counts: 30 allocated
    _payment(s3.name, "2026-10-04", 50, "TEST-PE3")    # excluded: not overdue
    frappe.db.commit()
    print("Factor 2 done")


# --------------------------------------------------------------------------
# Factor 3: Quotation-to-Order Conversion
# Pragati = 1 of 2 = 50%; Aanshi = 0%. Also adds +150 to Pragati's Net SO.
# --------------------------------------------------------------------------
def factor_3():
    _ctx()
    o1 = _opportunity(PALMER, "2026-10-02", "TEST-OPP-P1")
    q1 = _quotation(o1, "2026-10-02", 1, 150, "TEST-Q-P1")
    _so_from_quotation(q1.name, "2026-10-04", "TEST-P2")   # converted: 150

    o2 = _opportunity(PALMER, "2026-10-03", "TEST-OPP-P2")
    _quotation(o2, "2026-10-03", 1, 120, "TEST-Q-P2")      # quotation, no order

    _opportunity(PALMER, "2026-10-03", "TEST-OPP-P3")      # no quotation: ignored
    frappe.db.commit()
    print("Factor 3 done")


# --------------------------------------------------------------------------
# Factor 4: CRM Follow-up Compliance
# Pragati = 1 of 2 = 50%; Aanshi = 0 of 1 = 0%
# --------------------------------------------------------------------------
def factor_4():
    _ctx()
    if frappe.db.exists("ToDo", {"description": "TEST-TD-P1"}):
        print("Factor 4 already created")
        return

    # Done: comment (outcome) added after the ToDo, closed by the due date
    t1 = _todo("Customer", PALMER, "2026-10-10", "TEST-TD-P1")
    time.sleep(1)
    frappe.get_doc("Customer", PALMER).add_comment(
        "Comment", "TEST: called customer, order discussed")
    t1.status = "Closed"
    t1.save(ignore_permissions=True)

    # Not done: closed with no outcome after it
    time.sleep(1)
    t2 = _todo("Customer", PALMER, "2026-10-10", "TEST-TD-P2")
    t2.status = "Closed"
    t2.save(ignore_permissions=True)

    # Aanshi: due date passed, still open
    _todo("Customer", RENT, "2026-10-04", "TEST-TD-R1")
    frappe.db.commit()
    print("Factor 4 done")


# --------------------------------------------------------------------------
# Factor 5: Dispatch Value (with credit note)
# Pragati = 300; Aanshi = 200 - 100 = 100 (her Net SO drops from 300 to 200)
# --------------------------------------------------------------------------
def factor_5():
    _ctx()
    p1 = _get("Sales Order", "po_no", "TEST-P1")
    r1 = _get("Sales Order", "po_no", "TEST-R1")
    if not (p1 and r1):
        print("Run factor_1 first")
        return

    _si_from_so(p1.name, "2026-10-02", "TEST-SI-P1")          # 300
    si_r1 = _si_from_so(r1.name, "2026-10-03", "TEST-SI-R1")  # 200

    if not _get("Sales Invoice", "po_no", "TEST-CN-R1"):
        from erpnext.controllers.sales_and_purchase_return import make_return_doc
        cn = make_return_doc("Sales Invoice", si_r1.name)
        cn.set_posting_time = 1
        cn.posting_date = "2026-10-04"
        cn.due_date = "2026-10-04"
        cn.update_stock = 0
        cn.items[0].qty = -1          # returns 1 of 2 units = -100
        cn.po_no = "TEST-CN-R1"
        cn.insert(ignore_permissions=True)
        cn.submit()
    frappe.db.commit()
    print("Factor 5 done")


# --------------------------------------------------------------------------
# Factor 6: Lead-to-Enquiry Ratio (also enables factors 7 and 9 checks)
# Pragati = 1 of 1 = 100% (needs factor 3); Aanshi = 0 of 1 = 0%
# Original lead_name values are saved so reset_lead_links() can restore them.
# --------------------------------------------------------------------------
def factor_6():
    _ctx()
    lp = _lead("TESTLEAD-P1", "testlead.p1@example.com")
    la = _lead("TESTLEAD-A1", "testlead.a1@example.com")
    for cust, lead in ((PALMER, lp), (RENT, la)):
        key = f"test_orig_lead_{cust}"
        if frappe.db.get_global(key) is None:
            frappe.db.set_global(key, frappe.db.get_value("Customer", cust, "lead_name") or "-")
        frappe.db.set_value("Customer", cust, "lead_name", lead.name)
    frappe.db.commit()
    print("Factor 6 done")


# Factors 7, 8 and 9 need no new data (they reuse the documents above):
#   7 Lead to SO: Pragati 450, Aanshi 300 (Yearly period)
#   8 Direct SO : Pragati 150, Aanshi 0
#   9 Repeat SO : Pragati 450, Aanshi 100


def run_all():
    baseline()
    for fn in (factor_1, factor_2, factor_3, factor_4, factor_5, factor_6):
        fn()
    print("All test data created. Run the report with as-on date 2026-10-05.")


# --------------------------------------------------------------------------
# Reset / cleanup
# --------------------------------------------------------------------------
def reset_lead_links():
    for cust in (PALMER, RENT):
        key = f"test_orig_lead_{cust}"
        orig = frappe.db.get_global(key)
        if orig is not None:
            frappe.db.set_value("Customer", cust, "lead_name", None if orig == "-" else orig)
            frappe.db.set_global(key, None)
    frappe.db.commit()


def cleanup():
    """Cancel and delete everything tagged TEST-, and restore lead_name."""
    _ctx()
    reset_lead_links()

    def purge(doctype, filters, order_by=None):
        for name in frappe.get_all(doctype, filters=filters, pluck="name", order_by=order_by):
            doc = frappe.get_doc(doctype, name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc(doctype, name, force=1, ignore_permissions=True)

    purge("Payment Entry", {"reference_no": ["like", "TEST-%"]})
    purge("Sales Invoice", {"po_no": ["like", "TEST-%"]}, "is_return desc")  # credit notes first
    purge("Sales Order", {"po_no": ["like", "TEST-%"]})
    purge("Quotation", {"title": ["like", "TEST-%"]})
    purge("Opportunity", {"title": ["like", "TEST-%"]})
    purge("ToDo", {"description": ["like", "TEST-%"]})
    purge("Lead", {"email_id": ["like", "testlead.%"]})
    frappe.db.delete("Comment", {"reference_doctype": "Customer", "content": ["like", "%TEST:%"]})
    frappe.db.commit()
    print("Test data removed")