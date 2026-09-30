# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

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

PERCENT_FACTORS = {FACTOR_Q2O, FACTOR_FOLLOWUP, FACTOR_L2E}
BAD_LEAD_STATUS = {"do not contact", "cancelled", "disqualified", "junk"}


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

    user_map = get_user_map()
    period_cache, metric_cache, data = {}, {}, []

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
        freq_key = normalize_freq(t.frequency)
        if freq_key not in period_cache:
            period_cache[freq_key] = get_period(freq_key, filters.as_on_date, filters.company)
        from_date, to_date = period_cache[freq_key]

        # metrics are computed once per (factor, frequency) for all customers
        mkey = (t.factor, freq_key)
        if mkey not in metric_cache:
            fn = metric_fns.get(t.factor)
            metric_cache[mkey] = fn(from_date, to_date, filters.company, user_map) if fn else {}
        m = metric_cache[mkey].get((t.customer, t.sales_person), {})

        achievement = flt(m.get("value"))
        target = flt(t.target)
        ach_pct = (achievement / target * 100) if target else 0
        weightage = flt(t.weightage)

        data.append({
            "customer": t.customer,
            "customer_name": t.customer_name,
            "sales_person": t.sales_person,
            "factor": t.factor,
            "measure": "Percent" if t.factor in PERCENT_FACTORS else "Amount",
            "frequency": freq_key,
            "from_date": from_date,
            "to_date": to_date,
            "target": target,
            "achievement": achievement,
            "achievement_pct": ach_pct,
            "weightage": weightage,
            "weighted_pct": ach_pct * weightage / 100,
            "numerator": flt(m.get("num")),
            "denominator": flt(m.get("den")),
        })

    return columns, data


# --------------------------------------------------------------------------
# Columns / targets / periods
# --------------------------------------------------------------------------
def get_columns():
    return [
        {"label": _("Customer"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 140},
        {"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 160},
        {"label": _("Sales Person"), "fieldname": "sales_person", "fieldtype": "Link", "options": "Sales Person", "width": 140},
        {"label": _("Factor"), "fieldname": "factor", "fieldtype": "Data", "width": 260},
        # {"label": _("Measure"), "fieldname": "measure", "fieldtype": "Data", "width": 80},
        {"label": _("Frequency"), "fieldname": "frequency", "fieldtype": "Data", "width": 90},
        {"label": _("From Date"), "fieldname": "from_date", "fieldtype": "Date", "width": 95},
        {"label": _("To Date"), "fieldname": "to_date", "fieldtype": "Date", "width": 95},
        {"label": _("Target"), "fieldname": "target", "fieldtype": "Float", "precision": 2, "width": 110},
        {"label": _("Achievement"), "fieldname": "achievement", "fieldtype": "Float", "precision": 2, "width": 120},
        {"label": _("Achievement %"), "fieldname": "achievement_pct", "fieldtype": "Percent", "precision": 2, "width": 110},
        {"label": _("Weightage %"), "fieldname": "weightage", "fieldtype": "Percent", "precision": 2, "width": 100},
        {"label": _("Weighted Achievement %"), "fieldname": "weighted_pct", "fieldtype": "Percent", "precision": 2, "width": 130},
    ]


def get_targets(filters):
    conds, values = "", {}
    if filters.get("customer"):
        conds += " and c.name = %(customer)s"
        values["customer"] = filters.customer
    if filters.get("sales_person"):
        conds += " and st.sales_person = %(sales_person)s"
        values["sales_person"] = filters.sales_person
    if filters.get("factor"):
        conds += " and st.custom_factor = %(factor)s"
        values["factor"] = filters.factor

    return frappe.db.sql(
        f"""
        select c.name as customer,
               c.customer_name,
               st.sales_person,
               st.custom_factor as factor,
               st.custom_frequency as frequency,
               st.custom_target_value as target,
               st.allocated_percentage as weightage
        from `tabSales Team` st
        inner join `tabCustomer` c on c.name = st.parent
        where st.parenttype = 'Customer'
          and st.parentfield = 'sales_team'
          and c.disabled = 0
          and ifnull(st.custom_factor, '') != ''
          {conds}
        order by c.name, st.sales_person, st.idx
        """,
        values, as_dict=True,
    )


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
        inner join `tabSales Team` st
            on st.parent = so.name and st.parenttype = 'Sales Order'
           and st.parentfield = 'sales_team'
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
        """
        select si.customer, st.sales_person,
               sum(si.base_net_total * st.allocated_percentage / 100) as value
        from `tabSales Invoice` si
        inner join `tabSales Team` st
            on st.parent = si.name and st.parenttype = 'Sales Invoice'
           and st.parentfield = 'sales_team'
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
        """
        select si.customer, st.sales_person,
               sum(si.base_net_total * st.allocated_percentage / 100) as value
        from `tabSales Invoice` si
        inner join `tabSales Team` st
            on st.parent = si.name and st.parenttype = 'Sales Invoice'
           and st.parentfield = 'sales_team'
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
        """
        select si.customer, st.sales_person,
               sum(per.allocated_amount * st.allocated_percentage / 100) as value
        from `tabPayment Entry` pe
        inner join `tabPayment Entry Reference` per
            on per.parent = pe.name and per.reference_doctype = 'Sales Invoice'
        inner join `tabSales Invoice` si on si.name = per.reference_name
        inner join `tabSales Team` st
            on st.parent = si.name and st.parenttype = 'Sales Invoice'
           and st.parentfield = 'sales_team'
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