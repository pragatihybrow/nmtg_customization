# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.utils import (
    flt, getdate, nowdate, add_months, get_first_day, get_last_day,
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

# Factors credited to the sales person on the transaction's own Sales Team
# (Sales Order / Sales Invoice). The rest are credited via Customer > Sales Team.
SP_KEYED_FACTORS = {
    FACTOR_NET_SO, FACTOR_OVERDUE, FACTOR_DISPATCH,
    FACTOR_LEAD_SO, FACTOR_DIRECT_SO, FACTOR_REPEAT,
}

BAD_LEAD_STATUS = {"do not contact", "cancelled", "disqualified", "junk"}


def normalize_factor(label):
    """'CRM Follow-up Compliance(%)' / 'Lead-to-Enquiry Ratio (%)' -> canonical factor name."""
    key = re.sub(r"\s*\(%\)\s*", "", label or "").strip().lower()
    return FACTOR_KEYS.get(key)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def execute(filters=None):
    filters = frappe._dict(filters or {})
    filters.company = (
        filters.company
        or frappe.defaults.get_user_default("Company")
        or frappe.defaults.get_global_default("company")
    )

    min_pct = get_num(filters, "min_achievement", 80)
    max_pct = get_num(filters, "max_achievement", 120)
    incentive_pct = get_num(filters, "incentive_percent", 20)
    salary_override = flt(filters.get("monthly_salary"))

    columns = get_columns()
    fy_start, fy_end = get_fy_dates(filters)
    months = get_months(fy_start, fy_end)
    targets = get_targets(filters)
    if not targets or not months:
        return columns, []

    assigned = get_assigned_customers()  # {sales_person: [customers]}
    ctc_map = {} if salary_override else get_ctc_map()
    metric_cache = {}
    sales_persons = sorted({t.sales_person for t in targets})
    monthly = {sp: [] for sp in sales_persons}

    for m_start, m_end in months:
        scores = get_month_scores(targets, m_end, filters.company, assigned, metric_cache)
        salaries = {} if salary_override else get_salary_map(m_end)

        for sp in sales_persons:
            achievement = flt(scores.get(sp))
            # Priority: filter override > Salary Structure Assignment > Employee CTC / 12
            salary = salary_override or flt(salaries.get(sp)) or flt(ctc_map.get(sp))
            eligible = achievement >= min_pct
            capped = min(achievement, max_pct)
            # monthly salary x achievement % (capped) x incentive %
            incentive = (salary * capped / 100 * incentive_pct / 100) if eligible else 0

            monthly[sp].append({
                "sales_person": sp,
                "month": m_start.strftime("%b %Y"),
                "monthly_salary": salary,
                "target_pct": 100,
                "achievement_pct": achievement,
                "capped_pct": capped if eligible else 0,
                "eligible": "Yes" if eligible else "No",
                "incentive": incentive,
            })

    data, grand_total = [], 0
    for sp in sales_persons:
        total = 0
        for idx, row in enumerate(monthly[sp], start=1):
            row["sr_no"] = idx
            total += row["incentive"]
            data.append(row)
        grand_total += total
        data.append({
            "sales_person": sp,
            "month": _("Total"),
            "incentive": total,
            "is_total": 1,
        })

    if len(sales_persons) > 1:
        data.append({
            "month": _("Grand Total"),
            "incentive": grand_total,
            "is_total": 1,
        })

    return columns, data


def get_num(filters, key, default):
    v = filters.get(key)
    return flt(v) if v not in (None, "") else default


def get_columns():
    return [
        {"label": _("Sr"), "fieldname": "sr_no", "fieldtype": "Int", "width": 50},
        {"label": _("Sales Person"), "fieldname": "sales_person", "fieldtype": "Link", "options": "Sales Person", "width": 150},
        {"label": _("Month"), "fieldname": "month", "fieldtype": "Data", "width": 110},
        {"label": _("Monthly Salary"), "fieldname": "monthly_salary", "fieldtype": "Currency", "width": 120},
        {"label": _("Target %"), "fieldname": "target_pct", "fieldtype": "Percent", "precision": 2, "width": 100},
        {"label": _("Total Target vs Achieved %"), "fieldname": "achievement_pct", "fieldtype": "Percent", "precision": 2, "width": 170},
        {"label": _("Achievement % Considered"), "fieldname": "capped_pct", "fieldtype": "Percent", "precision": 2, "width": 160},
        {"label": _("Eligible for Incentive"), "fieldname": "eligible", "fieldtype": "Data", "width": 130},
        {"label": _("Total Incentive Value"), "fieldname": "incentive", "fieldtype": "Currency", "width": 140},
    ]


# --------------------------------------------------------------------------
# Months, salary, targets, assignments
# --------------------------------------------------------------------------
def get_fy_dates(filters):
    fy = filters.get("fiscal_year")
    if not fy:
        from erpnext.accounts.utils import get_fiscal_year
        fy = get_fiscal_year(nowdate(), company=filters.company)[0]
    start, end = frappe.db.get_value("Fiscal Year", fy, ["year_start_date", "year_end_date"])
    return getdate(start), getdate(end)


def get_months(fy_start, fy_end):
    """(month_start, month_end) from fiscal year start up to the current month."""
    today = getdate(nowdate())
    out, cur = [], get_first_day(fy_start)
    while cur <= fy_end and cur <= today:
        out.append((cur, get_last_day(cur)))
        cur = add_months(cur, 1)
    return out


def get_salary_map(as_of):
    """Sales Person -> latest Salary Structure Assignment base on/before date."""
    rows = frappe.db.sql(
        """
        select sp.name as sales_person, ssa.base
        from `tabSales Person` sp
        inner join `tabSalary Structure Assignment` ssa on ssa.employee = sp.employee
        where ssa.docstatus = 1 and ssa.from_date <= %(as_of)s
        order by ssa.from_date asc, ssa.creation asc
        """,
        {"as_of": as_of}, as_dict=True,
    )
    return {r.sales_person: flt(r.base) for r in rows}  # latest row wins


def get_ctc_map():
    """Sales Person -> monthly salary from Employee CTC (annual / 12).
    Fallback when no Salary Structure Assignment exists."""
    rows = frappe.db.sql(
        """
        select sp.name as sales_person, e.ctc
        from `tabSales Person` sp
        inner join `tabEmployee` e on e.name = sp.employee
        where ifnull(e.ctc, 0) > 0
        """,
        as_dict=True,
    )
    return {r.sales_person: flt(r.ctc) / 12 for r in rows}


def get_targets(filters):
    """Targets and weightage from Sales Person > custom_sales_target (Sales Person CT)."""
    conds, values = "", {}
    if filters.get("sales_person"):
        conds += " and sp.name = %(sales_person)s"
        values["sales_person"] = filters.sales_person

    return frappe.db.sql(
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


def get_assigned_customers():
    """Sales Person -> customers listed against them in Customer > Sales Team.
    Used only for the CRM based factors."""
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


def aggregate(metrics, keys, is_percent):
    """Total across the given keys (sales person or customers).
    Amount  -> sum of values.
    Percent -> total numerator / total denominator * 100."""
    if is_percent:
        num = sum(flt(metrics.get(k, {}).get("num")) for k in keys)
        den = sum(flt(metrics.get(k, {}).get("den")) for k in keys)
        return (num / den * 100) if den else 0
    return sum(flt(metrics.get(k, {}).get("value")) for k in keys)


# --------------------------------------------------------------------------
# Monthly overall achievement per sales person
# --------------------------------------------------------------------------
def get_metric_fns():
    return {
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


def get_month_scores(targets, month_end, company, assigned, metric_cache):
    """
    Overall achievement % per sales person for the month ending on month_end:

        Sum(Actual Weightage Achieved) / Sum(Target Weightage) x 100
        Actual Weightage Achieved = (Total Actual Value / Target) x Weightage

    Each factor is measured from the start of its own period (month / quarter /
    fiscal year, by the factor's frequency) up to the month end.
    Transaction factors (Sales Order / Sales Invoice / Payment) are credited by
    the transaction's own Sales Team; CRM factors use the customers assigned to
    the sales person.
    """
    metric_fns = get_metric_fns()
    period_cache = {}
    achieved, weight_total = {}, {}

    for t in targets:
        factor = normalize_factor(t.factor)
        if not factor:
            continue

        freq = normalize_freq(t.frequency)
        if freq not in period_cache:
            p_from, p_to = get_period(freq, month_end, company)
            period_cache[freq] = (p_from, min(getdate(p_to), getdate(month_end)))
        p_from, p_to = period_cache[freq]

        mkey = (factor, p_from, p_to)
        if mkey not in metric_cache:
            fn = metric_fns.get(factor)
            metric_cache[mkey] = fn(p_from, p_to, company) if fn else {}

        if factor in SP_KEYED_FACTORS:
            keys = [t.sales_person]  # metric is already keyed by sales person
        else:
            keys = assigned.get(t.sales_person, [])
        actual = aggregate(metric_cache[mkey], keys, factor in PERCENT_FACTORS)

        target = flt(t.target)  # target_value is a Data field, so convert
        weightage = flt(t.weightage)
        weighted = (actual / target * weightage) if target else 0

        achieved[t.sales_person] = achieved.get(t.sales_person, 0) + weighted
        weight_total[t.sales_person] = weight_total.get(t.sales_person, 0) + weightage

    return {
        sp: (achieved[sp] / weight_total[sp] * 100) if weight_total[sp] else 0
        for sp in weight_total
    }


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


def value_map(rows, key="customer"):
    """rows with <key>, value -> {<key>: {"value": ...}}"""
    return {r[key]: {"value": flt(r.value)} for r in rows}


def ratio_map(rows):
    """rows with customer, num, den -> {customer: {"num": ..., "den": ...}}"""
    return {r.customer: {"num": flt(r.num), "den": flt(r.den)} for r in rows}


# --------------------------------------------------------------------------
# Sales Order based factors (net value = base_net_total: no tax / freight)
# All metrics below return {sales_person: {"value": ...}}, split by the
# Sales Order's own Sales Team (allocated_percentage).
# --------------------------------------------------------------------------
def so_value(from_date, to_date, company, extra=""):
    return frappe.db.sql(
        f"""
        select st.sales_person,
               sum(so.base_net_total * ifnull(st.allocated_percentage, 0) / 100) as value
        from `tabSales Order` so
        inner join `tabSales Team` st
            on st.parent = so.name and st.parenttype = 'Sales Order'
        where so.docstatus = 1
          and so.company = %(company)s
          and so.transaction_date between %(from_date)s and %(to_date)s
          {extra}
        group by st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )


def metric_net_so(from_date, to_date, company):
    # Submitted SOs only (cancelled are docstatus 2, so excluded)
    result = value_map(so_value(from_date, to_date, company), "sales_person")

    # Deduct returns (credit notes) raised against Sales Orders in the period,
    # split by the return invoice's Sales Team
    returns = frappe.db.sql(
        """
        select st.sales_person,
               sum(si.base_net_total * ifnull(st.allocated_percentage, 0) / 100) as value
        from `tabSales Invoice` si
        inner join `tabSales Team` st
            on st.parent = si.name and st.parenttype = 'Sales Invoice'
        where si.docstatus = 1 and si.is_return = 1
          and si.company = %(company)s
          and si.posting_date between %(from_date)s and %(to_date)s
          and exists (select 1 from `tabSales Invoice Item` sii
                      where sii.parent = si.name and ifnull(sii.sales_order, '') != '')
        group by st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    for r in returns:  # return values are already negative
        result.setdefault(r.sales_person, {"value": 0})
        result[r.sales_person]["value"] += flt(r.value)
    return result


def metric_lead_so(from_date, to_date, company):
    # Customer was created from a Lead
    extra = """
        and exists (select 1 from `tabCustomer` c
                    where c.name = so.customer and ifnull(c.lead_name, '') != '')
    """
    return value_map(so_value(from_date, to_date, company, extra), "sales_person")


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
    return value_map(so_value(from_date, to_date, company, extra), "sales_person")


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
    return value_map(so_value(from_date, to_date, company, extra), "sales_person")


# --------------------------------------------------------------------------
# Sales Invoice / Payment Entry based factors
# Split by the Sales Invoice's own Sales Team, keyed by sales person.
# --------------------------------------------------------------------------
def metric_dispatch(from_date, to_date, company):
    # Returns / credit notes carry negative base_net_total, so they reduce it
    rows = frappe.db.sql(
        """
        select st.sales_person,
               sum(si.base_net_total * ifnull(st.allocated_percentage, 0) / 100) as value
        from `tabSales Invoice` si
        inner join `tabSales Team` st
            on st.parent = si.name and st.parenttype = 'Sales Invoice'
        where si.docstatus = 1
          and si.company = %(company)s
          and si.posting_date between %(from_date)s and %(to_date)s
        group by st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return value_map(rows, "sales_person")


def metric_overdue(from_date, to_date, company):
    # Allocated amount only, against invoices that were overdue at payment time
    rows = frappe.db.sql(
        """
        select st.sales_person,
               sum(per.allocated_amount * ifnull(st.allocated_percentage, 0) / 100) as value
        from `tabPayment Entry` pe
        inner join `tabPayment Entry Reference` per
            on per.parent = pe.name and per.reference_doctype = 'Sales Invoice'
        inner join `tabSales Invoice` si on si.name = per.reference_name
        inner join `tabSales Team` st
            on st.parent = si.name and st.parenttype = 'Sales Invoice'
        where pe.docstatus = 1
          and pe.payment_type = 'Receive'
          and pe.company = %(company)s
          and pe.posting_date between %(from_date)s and %(to_date)s
          and si.due_date < pe.posting_date
        group by st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return value_map(rows, "sales_person")


# --------------------------------------------------------------------------
# CRM based factors (still customer based)
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