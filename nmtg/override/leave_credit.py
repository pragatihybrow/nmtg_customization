import frappe
from fractions import Fraction
from frappe.utils import getdate, add_days, flt, get_first_day, get_last_day

from hrms.hr.doctype.leave_allocation.leave_allocation import (
    create_additional_leave_ledger_entry,
)

CL_LEAVE_TYPE = "Casual Leave"       # must match your Leave Type name
PL_LEAVE_TYPE = "Privilege Leave"    # must match your Leave Type name
YEARLY_CL = 7
MIN_DAYS_FOR_PRESENT_MONTH = 20
PL_PER_MONTH = 1.0
CL_PER_MONTH = 0.5


# ------------------------------------------------------------ calculations
def calculate_cl(months_present, yearly_cl=YEARLY_CL):
    raw = Fraction(months_present * yearly_cl, 12)
    return float(int(raw + Fraction(1, 2)))   # round half up: 3.5 -> 4


def _present_days(start, end):
    """{employee: {month_number: present_days}} for the date range."""
    rows = frappe.db.sql(
        """
        select employee, month(attendance_date) as m,
            sum(case
                when status in ('Present', 'Work From Home') then 1
                when status = 'Half Day' then 0.5
                else 0 end) as days
        from `tabAttendance`
        where docstatus = 1 and attendance_date between %s and %s
        group by employee, month(attendance_date)
        """,
        (start, end),
        as_dict=True,
    )
    data = {}
    for r in rows:
        data.setdefault(r.employee, {})[r.m] = flt(r.days)
    return data


def _active_employees():
    return frappe.get_all("Employee", filters={"status": "Active"}, pluck="name")


# --------------------------------------------------------- allocation helpers
def _top_up(employee, leave_type, year_start, year_end, target, on_date):
    """Raise the employee's allocation for the year to `target` (never lowers)."""
    existing = frappe.db.get_value(
        "Leave Allocation",
        {
            "employee": employee,
            "leave_type": leave_type,
            "docstatus": 1,
            "from_date": ["<=", year_end],
            "to_date": [">=", year_start],
        },
        ["name", "total_leaves_allocated"],
        as_dict=True,
    )

    current = flt(existing.total_leaves_allocated) if existing else 0.0
    diff = flt(target - current, 2)
    if diff <= 0:
        return

    if not existing:
        joining = frappe.db.get_value("Employee", employee, "date_of_joining")
        from_date = max(getdate(year_start), getdate(joining)) if joining else year_start
        la = frappe.get_doc(
            {
                "doctype": "Leave Allocation",
                "employee": employee,
                "leave_type": leave_type,
                "from_date": from_date,
                "to_date": year_end,
                "new_leaves_allocated": diff,
            }
        )
        la.insert()
        la.submit()
        return

    la = frappe.get_doc("Leave Allocation", existing.name)
    la.db_set(
        {
            "new_leaves_allocated": flt(la.new_leaves_allocated) + diff,
            "total_leaves_allocated": flt(la.total_leaves_allocated) + diff,
        }
    )
    create_additional_leave_ledger_entry(la, diff, getdate(on_date))


def _credit(employee, leave_type, amount, year_end, on_date):
    """Add `amount` to the year's allocation, once per employee/type/date."""
    if frappe.db.exists(
        "Leave Ledger Entry",
        {
            "employee": employee,
            "leave_type": leave_type,
            "transaction_type": "Leave Allocation",
            "from_date": on_date,
            "docstatus": 1,
        },
    ):
        return

    existing = frappe.db.get_value(
        "Leave Allocation",
        {
            "employee": employee,
            "leave_type": leave_type,
            "docstatus": 1,
            "from_date": ["<=", on_date],
            "to_date": [">=", on_date],
        },
        "name",
    )

    if not existing:
        la = frappe.get_doc(
            {
                "doctype": "Leave Allocation",
                "employee": employee,
                "leave_type": leave_type,
                "from_date": on_date,
                "to_date": year_end,
                "new_leaves_allocated": amount,
            }
        )
        la.insert()
        la.submit()
        return

    la = frappe.get_doc("Leave Allocation", existing)
    la.db_set(
        {
            "new_leaves_allocated": flt(la.new_leaves_allocated) + amount,
            "total_leaves_allocated": flt(la.total_leaves_allocated) + amount,
        }
    )
    create_additional_leave_ledger_entry(la, amount, on_date)


# ------------------------------------------------------------------ jobs
def credit_monthly_leave(run_date=None):
    """1st of every month: credit PL and CL for the month that just ended."""
    today = getdate(run_date) if run_date else getdate()
    ref = add_days(today, -1)
    # ...rest unchanged                   # last day of previous month
    year_end = getdate(f"{ref.year}-12-31")
    # On 1 Jan, December is credited inside the old year so it counts for encashment
    on_date = today if today.year == ref.year else ref

    data = _present_days(get_first_day(ref), get_last_day(ref))

    for emp in _active_employees():
        try:
            if sum(data.get(emp, {}).values()) < MIN_DAYS_FOR_PRESENT_MONTH:
                continue
            _credit(emp, PL_LEAVE_TYPE, PL_PER_MONTH, year_end, on_date)
            _credit(emp, CL_LEAVE_TYPE, CL_PER_MONTH, year_end, on_date)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(title=f"Monthly leave credit failed for {emp}")


def encash_casual_leave(run_date=None):
    from hrms.hr.doctype.leave_application.leave_application import get_leave_balance_on

    today = getdate(run_date) if run_date else getdate()
    year_end = add_days(today, -1)
    year_start = getdate(f"{year_end.year}-01-01")
    data = _present_days(year_start, year_end)

    for emp in _active_employees():
        try:
            months = sum(
                1 for d in data.get(emp, {}).values() if d >= MIN_DAYS_FOR_PRESENT_MONTH
            )
            if not months:
                continue

            _top_up(emp, CL_LEAVE_TYPE, year_start, year_end,
                    calculate_cl(months), year_end)

            if frappe.db.exists(
                "Leave Encashment",
                {
                    "employee": emp,
                    "leave_type": CL_LEAVE_TYPE,
                    "encashment_date": year_end,
                    "docstatus": ["<", 2],
                },
            ):
                continue
            if flt(get_leave_balance_on(emp, CL_LEAVE_TYPE, year_end)) <= 0:
                continue

            enc = frappe.get_doc(
                {
                    "doctype": "Leave Encashment",
                    "employee": emp,
                    "leave_type": CL_LEAVE_TYPE,
                    "encashment_date": year_end,
                }
            )
            enc.insert()
            enc.submit()
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(title=f"CL encashment failed for {emp}")



def _employee_of_user():
    return frappe.db.get_value(
        "Employee", {"user_id": frappe.session.user, "status": "Active"}
    )



def _balance(employee, leave_type):
    from hrms.hr.doctype.leave_application.leave_application import get_leave_balance_on
    return flt(get_leave_balance_on(employee, leave_type, getdate()), 2)


@frappe.whitelist()
def get_my_leave_dashboard():
    emp = _employee_of_user()
    if not emp:
        return {}

    today = getdate()
    month_days = flt(
        sum(_present_days(get_first_day(today), today).get(emp, {}).values()), 1
    )

    # qualifying months this year, completed months only
    year_data = _present_days(getdate(f"{today.year}-01-01"), today).get(emp, {})
    qualifying = sum(
        1 for m, d in year_data.items()
        if m < today.month and d >= MIN_DAYS_FOR_PRESENT_MONTH
    )

    return {
        "pl": _balance(emp, PL_LEAVE_TYPE),
        "cl": _balance(emp, CL_LEAVE_TYPE),
        "short_hrs": _balance(emp, "Short Leave"),
        "month_days": month_days,
        "target_days": MIN_DAYS_FOR_PRESENT_MONTH,
        "qualifying_months": qualifying,
        "projected_cl_payout": calculate_cl(qualifying) if qualifying else 0,
    }