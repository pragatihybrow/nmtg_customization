# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.utils import (
    flt, getdate, nowdate, get_first_day, get_last_day,
    get_quarter_start, get_quarter_ending,
)

FACTOR_NET_SO = "Net Sales Order Value"
FACTOR_OVERDUE = "Overdue Collection"
FACTOR_Q2O = "Quotation-to-Order Conversion"
FACTOR_FOLLOWUP = "CRM Follow-up Compliance"
FACTOR_DISPATCH = "Dispatch Value"
FACTOR_L2E = "Lead-to-Enquiry Ratio"
FACTOR_LEAD_SO = "Lead to SO - Mkt Net order value"
FACTOR_DIRECT_SO = "Direct enquiry - SO : Direct SO value"
FACTOR_REPEAT = "Repeat customer SO value"

ALL_FACTORS = [
    FACTOR_NET_SO, FACTOR_OVERDUE, FACTOR_Q2O, FACTOR_FOLLOWUP, FACTOR_DISPATCH,
    FACTOR_L2E, FACTOR_LEAD_SO, FACTOR_DIRECT_SO, FACTOR_REPEAT,
]
FACTOR_KEYS = {f.lower(): f for f in ALL_FACTORS}

# Percentage-wise targets; every other factor is an amount (value) target
PERCENT_FACTORS = {FACTOR_Q2O, FACTOR_FOLLOWUP, FACTOR_L2E}
BAD_LEAD_STATUS = {"do not contact", "cancelled", "disqualified", "junk"}


def normalize_factor(label):
    """'CRM Follow-up Compliance(%)' / 'Lead-to-Enquiry Ratio (%)' -> canonical factor name."""
    key = re.sub(r"\s*\(%\)\s*", "", label or "").strip().lower()
    return FACTOR_KEYS.get(key)


def execute(filters=None):
    filters = frappe._dict(filters or {})
    filters.as_on_date = filters.as_on_date or nowdate()
    filters.company = (
        filters.company
        or frappe.defaults.get_user_default("Company")
        or frappe.defaults.get_global_default("company")
    )

    columns = get_columns()
    targets = get_targets(filters)
    if not targets:
        return columns, []

    assigned = get_assigned_customers()  # {sales_person: [customers]}
    period_cache, metric_cache = {}, {}
    rows_by_sp = {}

    metric_fns = {
        FACTOR_NET_SO: metric_net_so,
        FACTOR_OVERDUE: metric_overdue,
        FACTOR_Q2O: metric_q2o,
        FACTOR_FOLLOWUP: metric_followup,
        FACTOR_DISPATCH: metric_dispatch,
        FACTOR_L2E: metric_l2e,
        FACTOR_LEAD_SO: metric_lead_so,
        FACTOR_DIRECT_SO: metric_direct_so,
        FACTOR_REPEAT: metric_repeat,
    }

    for t in targets:
        factor_key = normalize_factor(t.factor)
        freq_key = normalize_freq(t.frequency)
        is_percent = factor_key in PERCENT_FACTORS

        if freq_key not in period_cache:
            period_cache[freq_key] = get_period(freq_key, filters.as_on_date, filters.company)
        from_date, to_date = period_cache[freq_key]

        # customer-wise metrics are computed once per (factor, frequency)
        mkey = (factor_key, freq_key)
        if mkey not in metric_cache:
            fn = metric_fns.get(factor_key)
            metric_cache[mkey] = fn(from_date, to_date, filters.company) if fn else {}
        customer_metrics = metric_cache[mkey]

        # total of all customers assigned to this sales person
        customers = assigned.get(t.sales_person, [])
        actual = aggregate(customer_metrics, customers, is_percent)

        target = flt(t.target)  # target_value is a Data field, so convert
        ach_pct = (actual / target * 100) if target else 0
        weightage = flt(t.weightage)

        rows_by_sp.setdefault(t.sales_person, []).append({
            "sales_person": t.sales_person,
            "factor": t.factor,
            "measure": "Percent" if is_percent else "Amount",
            "customers": len(customers),
            "frequency": freq_key,
            "from_date": from_date,
            "to_date": to_date,
            "target": target,
            "achievement": actual,
            "achievement_pct": ach_pct,
            "weightage": weightage,
            # (Total actual value / target) * weightage
            "weighted_pct": (actual / target * weightage) if target else 0,
            "is_total": 0,
        })

    data = []
    for sp, rows in rows_by_sp.items():
        data.extend(rows)
        data.append({
            "sales_person": sp,
            "factor": _("Total"),
            "measure": None,
            "customers": None,
            "frequency": None,
            "from_date": None,
            "to_date": None,
            "target": None,
            "achievement": None,
            "achievement_pct": None,
            "weightage": sum(r["weightage"] for r in rows),
            "weighted_pct": sum(r["weighted_pct"] for r in rows),
            "is_total": 1,
        })

    return columns, data


# --------------------------------------------------------------------------
# Columns / targets / assignments / periods
# --------------------------------------------------------------------------
def get_columns():
    return [
        {"label": _("Sales Person"), "fieldname": "sales_person", "fieldtype": "Link", "options": "Sales Person", "width": 150},
        {"label": _("Factor"), "fieldname": "factor", "fieldtype": "Data", "width": 260},
        {"label": _("Measure"), "fieldname": "measure", "fieldtype": "Data", "width": 80},
        {"label": _("Customers"), "fieldname": "customers", "fieldtype": "Int", "width": 80},
        {"label": _("Frequency"), "fieldname": "frequency", "fieldtype": "Data", "width": 90},
        {"label": _("From Date"), "fieldname": "from_date", "fieldtype": "Date", "width": 95},
        {"label": _("To Date"), "fieldname": "to_date", "fieldtype": "Date", "width": 95},
        {"label": _("Target"), "fieldname": "target", "fieldtype": "Float", "precision": 2, "width": 110},
        {"label": _("Total Actual Value"), "fieldname": "achievement", "fieldtype": "Float", "precision": 2, "width": 130},
        {"label": _("Achievement %"), "fieldname": "achievement_pct", "fieldtype": "Percent", "precision": 2, "width": 110},
        {"label": _("Weightage %"), "fieldname": "weightage", "fieldtype": "Percent", "precision": 2, "width": 100},
        {"label": _("Actual Weightage Achieved"), "fieldname": "weighted_pct", "fieldtype": "Percent", "precision": 2, "width": 150},
    ]


def get_targets(filters):
    conds, values = "", {}
    if filters.get("sales_person"):
        conds += " and sp.name = %(sales_person)s"
        values["sales_person"] = filters.sales_person

    rows = frappe.db.sql(
        f"""
        select sp.name as sales_person,
               ct.factor,
               ct.frequency,
               ct.target_value as target,
               ct.weightage
        from `tabSales Person` sp
        inner join `tabSales Person CT` ct
            on ct.parent = sp.name
           and ct.parenttype = 'Sales Person'
           and ct.parentfield = 'custom_sales_target'
        where sp.enabled = 1
          and ifnull(ct.factor, '') != ''
          {conds}
        order by sp.name, ct.idx
        """,
        values, as_dict=True,
    )

    if filters.get("factor"):
        wanted = normalize_factor(filters.factor)
        rows = [r for r in rows if normalize_factor(r.factor) == wanted]
    return rows


def get_assigned_customers():
    """Sales Person -> customers listed against them in Customer > Sales Team."""
    rows = frappe.db.sql(
        """
        select distinct st.sales_person, st.parent as customer
        from `tabSales Team` st
        inner join `tabCustomer` c on c.name = st.parent
        where st.parenttype = 'Customer'
          and st.parentfield = 'sales_team'
          and c.disabled = 0
          and ifnull(st.sales_person, '') != ''
        """,
        as_dict=True,
    )
    out = {}
    for r in rows:
        out.setdefault(r.sales_person, []).append(r.customer)
    return out


def aggregate(customer_metrics, customers, is_percent):
    """Total across all assigned customers.
    Amount  -> sum of values.
    Percent -> total numerator / total denominator * 100."""
    if is_percent:
        num = sum(flt(customer_metrics.get(c, {}).get("num")) for c in customers)
        den = sum(flt(customer_metrics.get(c, {}).get("den")) for c in customers)
        return (num / den * 100) if den else 0
    return sum(flt(customer_metrics.get(c, {}).get("value")) for c in customers)


def normalize_freq(freq):
    f = (freq or "").strip().lower()
    if f.startswith("month"):
        return "Monthly"
    if f.startswith("q"):  # also handles the "Qurterly" spelling
        return "Quarterly"
    if f.startswith("year") or f.startswith("annual"):
        return "Yearly"
    return "Monthly"


def get_period(freq, as_on_date, company):
    d = getdate(as_on_date)
    if freq == "Monthly":
        return get_first_day(d), get_last_day(d)
    if freq == "Quarterly":
        return getdate(get_quarter_start(d)), getdate(get_quarter_ending(d))
    try:
        from erpnext.accounts.utils import get_fiscal_year
        fy = get_fiscal_year(d, company=company)
        return getdate(fy[1]), getdate(fy[2])
    except Exception:
        return getdate(f"{d.year}-01-01"), getdate(f"{d.year}-12-31")


def value_map(rows):
    """rows with customer, value -> {customer: {"value": ...}}"""
    return {r.customer: {"value": flt(r.value)} for r in rows}


def ratio_map(rows):
    """rows with customer, num, den -> {customer: {"num": ..., "den": ...}}"""
    return {r.customer: {"num": flt(r.num), "den": flt(r.den)} for r in rows}


# --------------------------------------------------------------------------
# Sales Order based factors (net value = base_net_total: no tax / freight)
# All metrics below return {customer: {...}}
# --------------------------------------------------------------------------
def so_value(from_date, to_date, company, extra=""):
    return frappe.db.sql(
        f"""
        select so.customer, sum(so.base_net_total) as value
        from `tabSales Order` so
        where so.docstatus = 1
          and so.company = %(company)s
          and so.transaction_date between %(from_date)s and %(to_date)s
          {extra}
        group by so.customer
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )


def metric_net_so(from_date, to_date, company):
    # Submitted SOs only (cancelled are docstatus 2, so excluded)
    result = value_map(so_value(from_date, to_date, company))

    # Deduct returns (credit notes) raised against Sales Orders in the period
    returns = frappe.db.sql(
        """
        select si.customer, sum(si.base_net_total) as value
        from `tabSales Invoice` si
        where si.docstatus = 1 and si.is_return = 1
          and si.company = %(company)s
          and si.posting_date between %(from_date)s and %(to_date)s
          and exists (select 1 from `tabSales Invoice Item` sii
                      where sii.parent = si.name and ifnull(sii.sales_order, '') != '')
        group by si.customer
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    for r in returns:  # return values are already negative
        result.setdefault(r.customer, {"value": 0})
        result[r.customer]["value"] += flt(r.value)
    return result


def metric_lead_so(from_date, to_date, company):
    # Customer was created from a Lead
    extra = """
        and exists (select 1 from `tabCustomer` c
                    where c.name = so.customer and ifnull(c.lead_name, '') != '')
    """
    return value_map(so_value(from_date, to_date, company, extra))


def metric_direct_so(from_date, to_date, company):
    # SO -> Quotation -> Opportunity created directly against the Customer
    extra = """
        and exists (
            select 1 from `tabSales Order Item` soi
            inner join `tabQuotation` q on q.name = soi.prevdoc_docname
            inner join `tabOpportunity` op on op.name = q.opportunity
            where soi.parent = so.name and op.opportunity_from = 'Customer'
        )
    """
    return value_map(so_value(from_date, to_date, company, extra))


def metric_repeat(from_date, to_date, company):
    # The customer already had an earlier submitted Sales Order
    extra = """
        and exists (
            select 1 from `tabSales Order` prev
            where prev.customer = so.customer and prev.docstatus = 1
              and prev.name != so.name
              and (prev.transaction_date < so.transaction_date
                   or (prev.transaction_date = so.transaction_date
                       and prev.creation < so.creation))
        )
    """
    return value_map(so_value(from_date, to_date, company, extra))


# --------------------------------------------------------------------------
# Sales Invoice / Payment Entry based factors
# --------------------------------------------------------------------------
def metric_dispatch(from_date, to_date, company):
    # Returns / credit notes carry negative base_net_total, so they reduce it
    rows = frappe.db.sql(
        """
        select si.customer, sum(si.base_net_total) as value
        from `tabSales Invoice` si
        where si.docstatus = 1
          and si.company = %(company)s
          and si.posting_date between %(from_date)s and %(to_date)s
        group by si.customer
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return value_map(rows)


def metric_overdue(from_date, to_date, company):
    # Allocated amount only, against invoices that were overdue at payment time
    rows = frappe.db.sql(
        """
        select si.customer, sum(per.allocated_amount) as value
        from `tabPayment Entry` pe
        inner join `tabPayment Entry Reference` per
            on per.parent = pe.name and per.reference_doctype = 'Sales Invoice'
        inner join `tabSales Invoice` si on si.name = per.reference_name
        where pe.docstatus = 1
          and pe.payment_type = 'Receive'
          and pe.company = %(company)s
          and pe.posting_date between %(from_date)s and %(to_date)s
          and si.due_date < pe.posting_date
        group by si.customer
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return value_map(rows)


# --------------------------------------------------------------------------
# CRM based factors
# Customer is resolved via Opportunity (party = Customer, or Lead that became
# the Customer through Customer.lead_name). Returns numerator / denominator
# per customer so percentages can be totalled correctly.
# --------------------------------------------------------------------------
def metric_q2o(from_date, to_date, company):
    rows = frappe.db.sql(
        """
        select c.name as customer,
               count(distinct op.name) as den,
               count(distinct case when exists (
                    select 1 from `tabQuotation` q2
                    inner join `tabSales Order Item` soi on soi.prevdoc_docname = q2.name
                    inner join `tabSales Order` so on so.name = soi.parent and so.docstatus = 1
                    where q2.opportunity = op.name and q2.docstatus = 1
               ) then op.name end) as num
        from `tabOpportunity` op
        inner join `tabCustomer` c
            on (op.opportunity_from = 'Customer' and c.name = op.party_name)
            or (op.opportunity_from = 'Lead' and c.lead_name = op.party_name)
        where op.company = %(company)s
          and op.transaction_date between %(from_date)s and %(to_date)s
          and exists (select 1 from `tabQuotation` q
                      where q.opportunity = op.name and q.docstatus = 1)
        group by c.name
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return ratio_map(rows)


def metric_followup(from_date, to_date, company):
    rows = frappe.db.sql(
        """
        select c.name as customer,
               count(*) as den,
               sum(case when td.status = 'Closed'
                         and date(td.modified) <= td.date
                         and (
                            exists (select 1 from `tabCommunication` cm
                                    where cm.reference_doctype = td.reference_type
                                      and cm.reference_name = td.reference_name
                                      and cm.communication_date >= td.creation
                                      and cm.communication_date < date_add(td.date, interval 1 day))
                            or exists (select 1 from `tabComment` cmt
                                    where cmt.comment_type = 'Comment'
                                      and cmt.reference_doctype = td.reference_type
                                      and cmt.reference_name = td.reference_name
                                      and cmt.creation >= td.creation
                                      and cmt.creation < date_add(td.date, interval 1 day))
                         )
                   then 1 else 0 end) as num
        from `tabToDo` td
        left join `tabOpportunity` op
            on td.reference_type = 'Opportunity' and op.name = td.reference_name
        inner join `tabCustomer` c
            on (td.reference_type = 'Customer' and c.name = td.reference_name)
            or (td.reference_type = 'Lead' and c.lead_name = td.reference_name)
            or (td.reference_type = 'Opportunity' and (
                    (op.opportunity_from = 'Customer' and c.name = op.party_name)
                 or (op.opportunity_from = 'Lead' and c.lead_name = op.party_name)))
        where td.reference_type in ('Customer', 'Lead', 'Opportunity')
          and td.status != 'Cancelled'
          and ifnull(td.allocated_to, '') != ''
          and td.date between %(from_date)s and %(to_date)s
        group by c.name
        """,
        {"from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return ratio_map(rows)


def metric_l2e(from_date, to_date, company):
    # Leads that became this customer (Customer.lead_name = Lead);
    # "converted" = an Opportunity exists for the Lead (or its Customer)
    leads = frappe.db.sql(
        """
        select ld.name, ld.lead_name, ld.company_name, ld.email_id, ld.status,
               c.name as customer,
               exists (select 1 from `tabOpportunity` op
                       where (op.opportunity_from = 'Lead' and op.party_name = ld.name)
                          or (op.opportunity_from = 'Customer' and op.party_name = c.name)
               ) as converted
        from `tabLead` ld
        inner join `tabCustomer` c on c.lead_name = ld.name
        where ld.company = %(company)s
          and date(ld.creation) between %(from_date)s and %(to_date)s
        order by ld.creation
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )

    seen_emails, seen_leads, stats = set(), set(), {}
    for l in leads:
        if l.name in seen_leads:
            continue
        seen_leads.add(l.name)

        text = f"{l.lead_name or ''} {l.company_name or ''}".lower()
        if (l.status or "").lower() in BAD_LEAD_STATUS:
            continue
        if "test" in text or "junk" in text:
            continue
        email = (l.email_id or "").strip().lower()
        if email:
            if email in seen_emails:  # duplicate lead
                continue
            seen_emails.add(email)

        s = stats.setdefault(l.customer, {"num": 0, "den": 0})
        s["den"] += 1
        if l.converted:
            s["num"] += 1

    return stats