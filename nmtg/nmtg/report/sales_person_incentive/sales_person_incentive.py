# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

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

PERCENT_FACTORS = {FACTOR_Q2O, FACTOR_FOLLOWUP, FACTOR_L2E}
BAD_LEAD_STATUS = {"do not contact", "cancelled", "disqualified", "junk"}


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

    user_map = get_user_map()
    ctc_map = {} if salary_override else get_ctc_map()
    metric_cache = {}
    sales_persons = sorted({t.sales_person for t in targets})
    monthly = {sp: [] for sp in sales_persons}

    for m_start, m_end in months:
        scores = get_month_scores(targets, m_end, filters.company, user_map, metric_cache)
        salaries = {} if salary_override else get_salary_map(m_end)

        for sp in sales_persons:
            achievement = flt(scores.get(sp))
            # Priority: filter override > Salary Structure Assignment > Employee CTC / 12
            salary = salary_override or flt(salaries.get(sp)) or flt(ctc_map.get(sp))
            eligible = achievement >= min_pct
            capped = min(achievement, max_pct)
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
        {"label": _("Achieved %"), "fieldname": "achievement_pct", "fieldtype": "Percent", "precision": 2, "width": 110},
        {"label": _("Achievement % Considered"), "fieldname": "capped_pct", "fieldtype": "Percent", "precision": 2, "width": 160},
        {"label": _("Eligible for Incentive"), "fieldname": "eligible", "fieldtype": "Data", "width": 130},
        {"label": _("Total Incentive Value"), "fieldname": "incentive", "fieldtype": "Currency", "width": 140},
    ]


# --------------------------------------------------------------------------
# Months, salary, targets
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
    """
    Targets come from the Sales Team rows of submitted Sales Orders
    (factor, frequency, target value and weightage on each row).
    If a customer has several Sales Orders carrying the same
    (sales person, factor), only the latest Sales Order's row is used,
    so targets are not multiplied by the number of orders.
    """
    conds = ""
    values = {"company": filters.company}
    if filters.get("sales_person"):
        conds += " and st.sales_person = %(sales_person)s"
        values["sales_person"] = filters.sales_person

    return frappe.db.sql(
        f"""
        select so.customer,
               st.sales_person,
               st.custom_factor as factor,
               st.custom_frequency as frequency,
               st.custom_target_value as target,
               st.allocated_percentage as weightage
        from `tabSales Team` st
        inner join `tabSales Order` so on so.name = st.parent
        inner join `tabCustomer` c on c.name = so.customer
        where st.parenttype = 'Sales Order'
          and st.parentfield = 'sales_team'
          and so.docstatus = 1
          and so.company = %(company)s
          and c.disabled = 0
          and ifnull(st.custom_factor, '') != ''
          and not exists (
              select 1
              from `tabSales Order` so2
              inner join `tabSales Team` st2
                  on st2.parent = so2.name
                 and st2.parenttype = 'Sales Order'
                 and st2.parentfield = 'sales_team'
              where so2.customer = so.customer
                and so2.docstatus = 1
                and so2.company = so.company
                and st2.sales_person = st.sales_person
                and st2.custom_factor = st.custom_factor
                and (so2.creation > so.creation
                     or (so2.creation = so.creation and so2.name > so.name))
          )
          {conds}
        order by so.customer, st.sales_person, st.idx
        """,
        values, as_dict=True,
    )


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


def get_month_scores(targets, month_end, company, user_map, metric_cache):
    """
    Overall achievement % per sales person for the month ending on month_end.

    Each factor is measured from the start of its own period (month / quarter /
    fiscal year, by the factor's frequency) up to the month end. Customer rows
    are rolled up to sales person level per factor, then combined using the
    factor weightage:  sum(factor % x weight) / sum(weight).
    """
    metric_fns = get_metric_fns()
    period_cache, agg = {}, {}

    for t in targets:
        freq = normalize_freq(t.frequency)
        if freq not in period_cache:
            p_from, p_to = get_period(freq, month_end, company)
            period_cache[freq] = (p_from, min(getdate(p_to), getdate(month_end)))
        p_from, p_to = period_cache[freq]

        mkey = (t.factor, p_from, p_to)
        if mkey not in metric_cache:
            fn = metric_fns.get(t.factor)
            metric_cache[mkey] = fn(p_from, p_to, company, user_map) if fn else {}
        m = metric_cache[mkey].get((t.customer, t.sales_person), {})

        a = agg.setdefault((t.sales_person, t.factor), {
            "target": 0, "value": 0, "num": 0, "den": 0, "weights": [], "n": 0,
        })
        a["target"] += flt(t.target)
        a["value"] += flt(m.get("value"))
        a["num"] += flt(m.get("num"))
        a["den"] += flt(m.get("den"))
        a["weights"].append(flt(t.weightage))
        a["n"] += 1

    per_sp = {}
    for (sp, factor), a in agg.items():
        if factor in PERCENT_FACTORS:
            target = a["target"] / a["n"] if a["n"] else 0
            value = (a["num"] / a["den"] * 100) if a["den"] else 0
        else:
            target = a["target"]
            value = a["value"]
        if target <= 0:  # no usable target, cannot be measured
            continue

        pct = value / target * 100
        weight = sum(a["weights"]) / len(a["weights"])
        s = per_sp.setdefault(sp, [0, 0])
        s[0] += pct * weight
        s[1] += weight

    return {sp: (s[0] / s[1] if s[1] else 0) for sp, s in per_sp.items()}


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


def get_user_map():
    """Sales Person -> User (through Employee)."""
    rows = frappe.db.sql(
        """
        select sp.name as sales_person, e.user_id
        from `tabSales Person` sp
        inner join `tabEmployee` e on e.name = sp.employee
        where ifnull(e.user_id, '') != ''
        """,
        as_dict=True,
    )
    return {r.sales_person: r.user_id for r in rows}


def attribution_sql(doctype):
    """
    Sales person attribution for a Sales Order / Sales Invoice.
    1. If the document has its own Sales Team rows, use them (with their %).
    2. Otherwise fall back to the distinct sales persons on the Customer,
       splitting 100% equally.
    Returns a sub-select with columns: parent, sales_person, allocated_percentage
    """
    return f"""
        select s.parent, s.sales_person, s.allocated_percentage
        from `tabSales Team` s
        where s.parenttype = '{doctype}' and s.parentfield = 'sales_team'

        union all

        select d.name as parent, cs.sales_person, 100.0 / cs.cnt as allocated_percentage
        from `tab{doctype}` d
        inner join (
            select x.parent, x.sales_person, y.cnt
            from (select distinct parent, sales_person
                  from `tabSales Team`
                  where parenttype = 'Customer' and parentfield = 'sales_team') x
            inner join (select parent, count(distinct sales_person) as cnt
                        from `tabSales Team`
                        where parenttype = 'Customer' and parentfield = 'sales_team'
                        group by parent) y
                on y.parent = x.parent
        ) cs on cs.parent = d.customer
        where not exists (
            select 1 from `tabSales Team` z
            where z.parent = d.name and z.parenttype = '{doctype}'
              and z.parentfield = 'sales_team'
        )
    """


def value_map(rows):
    """rows with customer, sales_person, value -> {(customer, sales_person): {...}}"""
    return {(r.customer, r.sales_person): {"value": flt(r.value)} for r in rows}


def expand_user_stats(stats, user_map):
    """stats: {(customer, user): [num, den]} -> {(customer, sales_person): {...}}"""
    user_to_sps = {}
    for sp, user in user_map.items():
        user_to_sps.setdefault(user, []).append(sp)

    out = {}
    for (customer, user), (num, den) in stats.items():
        for sp in user_to_sps.get(user, []):
            out[(customer, sp)] = {
                "value": (num / den * 100) if den else 0,
                "num": num,
                "den": den,
            }
    return out


# --------------------------------------------------------------------------
# Sales Order based factors (net value = base_net_total: no tax / freight)
# --------------------------------------------------------------------------
def so_value(from_date, to_date, company, extra=""):
    return frappe.db.sql(
        f"""
        select so.customer, st.sales_person,
               sum(so.base_net_total * st.allocated_percentage / 100) as value
        from `tabSales Order` so
        inner join ({attribution_sql('Sales Order')}) st on st.parent = so.name
        where so.docstatus = 1
          and so.company = %(company)s
          and so.transaction_date between %(from_date)s and %(to_date)s
          {extra}
        group by so.customer, st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )


def metric_net_so(from_date, to_date, company, user_map):
    # Submitted SOs only (cancelled are docstatus 2, so excluded)
    result = value_map(so_value(from_date, to_date, company))

    # Deduct returns (credit notes) raised against Sales Orders in the period
    returns = frappe.db.sql(
        f"""
        select si.customer, st.sales_person,
               sum(si.base_net_total * st.allocated_percentage / 100) as value
        from `tabSales Invoice` si
        inner join ({attribution_sql('Sales Invoice')}) st on st.parent = si.name
        where si.docstatus = 1 and si.is_return = 1
          and si.company = %(company)s
          and si.posting_date between %(from_date)s and %(to_date)s
          and exists (select 1 from `tabSales Invoice Item` sii
                      where sii.parent = si.name and ifnull(sii.sales_order, '') != '')
        group by si.customer, st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    for r in returns:  # return values are already negative
        key = (r.customer, r.sales_person)
        result.setdefault(key, {"value": 0})
        result[key]["value"] += flt(r.value)
    return result


def metric_lead_so(from_date, to_date, company, user_map):
    # Customer was created from a Lead
    extra = """
        and exists (select 1 from `tabCustomer` c
                    where c.name = so.customer and ifnull(c.lead_name, '') != '')
    """
    return value_map(so_value(from_date, to_date, company, extra))


def metric_direct_so(from_date, to_date, company, user_map):
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


def metric_repeat(from_date, to_date, company, user_map):
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
def metric_dispatch(from_date, to_date, company, user_map):
    # Returns / credit notes carry negative base_net_total, so they reduce it
    rows = frappe.db.sql(
        f"""
        select si.customer, st.sales_person,
               sum(si.base_net_total * st.allocated_percentage / 100) as value
        from `tabSales Invoice` si
        inner join ({attribution_sql('Sales Invoice')}) st on st.parent = si.name
        where si.docstatus = 1
          and si.company = %(company)s
          and si.posting_date between %(from_date)s and %(to_date)s
        group by si.customer, st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return value_map(rows)


def metric_overdue(from_date, to_date, company, user_map):
    rows = frappe.db.sql(
        f"""
        select si.customer, st.sales_person,
               sum(per.allocated_amount * st.allocated_percentage / 100) as value
        from `tabPayment Entry` pe
        inner join `tabPayment Entry Reference` per
            on per.parent = pe.name and per.reference_doctype = 'Sales Invoice'
        inner join `tabSales Invoice` si on si.name = per.reference_name
        inner join ({attribution_sql('Sales Invoice')}) st on st.parent = si.name
        where pe.docstatus = 1
          and pe.payment_type = 'Receive'
          and pe.company = %(company)s
          and pe.posting_date between %(from_date)s and %(to_date)s
          and si.due_date < pe.posting_date
        group by si.customer, st.sales_person
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    return value_map(rows)


# --------------------------------------------------------------------------
# CRM based factors
# Customer is resolved via Opportunity (party = Customer, or Lead that became
# the Customer through Customer.lead_name). Sales person = Sales Person whose
# Employee's User owns the CRM record.
# --------------------------------------------------------------------------
def metric_q2o(from_date, to_date, company, user_map):
    rows = frappe.db.sql(
        """
        select c.name as customer,
               coalesce(nullif(op.opportunity_owner, ''), op.owner) as usr,
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
        group by c.name, usr
        """,
        {"company": company, "from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    stats = {(r.customer, r.usr): [flt(r.num), flt(r.den)] for r in rows}
    return expand_user_stats(stats, user_map)


def metric_followup(from_date, to_date, company, user_map):
    rows = frappe.db.sql(
        """
        select c.name as customer,
               td.allocated_to as usr,
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
        group by c.name, td.allocated_to
        """,
        {"from_date": from_date, "to_date": to_date},
        as_dict=True,
    )
    stats = {(r.customer, r.usr): [flt(r.num), flt(r.den)] for r in rows}
    return expand_user_stats(stats, user_map)


def metric_l2e(from_date, to_date, company, user_map):
    # Leads that became this customer (Customer.lead_name = Lead)
    leads = frappe.db.sql(
        """
        select ld.name, ld.lead_name, ld.company_name, ld.email_id, ld.status,
               c.name as customer,
               coalesce(nullif(ld.lead_owner, ''), ld.owner) as usr,
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

    seen_emails, stats = set(), {}
    for l in leads:
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

        s = stats.setdefault((l.customer, l.usr), [0, 0])
        s[1] += 1
        if l.converted:
            s[0] += 1

    return expand_user_stats(stats, user_map)