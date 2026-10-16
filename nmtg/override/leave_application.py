import frappe
from frappe import _
from frappe.utils import get_first_day, get_last_day, getdate, flt, to_timedelta

from hrms.hr.doctype.leave_application.leave_application import (
    LeaveApplication,
    get_leave_balance_on,
)

SHORT_LEAVE_TYPE = "Short Leave"
MAX_HOURS_PER_MONTH = 2
FROM_FIELD = "custom_from_hours"   # verify full fieldname in Customize Form
TO_FIELD = "custom_to_hours"       # verify full fieldname in Customize Form


# ---------------------------------------------------------------- helpers
def _hours(from_time, to_time):
    return (to_timedelta(to_time) - to_timedelta(from_time)).total_seconds() / 3600


def _used_rows(employee, month_date, exclude=None):
    filters = {
        "employee": employee,
        "leave_type": SHORT_LEAVE_TYPE,
        "docstatus": ["<", 2],
        "status": ["not in", ["Rejected", "Cancelled"]],
        "from_date": ["between", [get_first_day(month_date), get_last_day(month_date)]],
    }
    if exclude:
        filters["name"] = ["!=", exclude]

    return frappe.get_all(
        "Leave Application",
        filters=filters,
        fields=["name", "from_date", FROM_FIELD, TO_FIELD],
    )


# ------------------------------------------------- validation (doc_events)
def validate_short_leave(doc, method=None):
    if doc.leave_type != SHORT_LEAVE_TYPE:
        return

    from_time, to_time = doc.get(FROM_FIELD), doc.get(TO_FIELD)

    if not (from_time and to_time):
        frappe.throw(_("From Hours and To Hours are required for Short Leave"))

    if not (doc.from_date and doc.to_date):
        frappe.throw(_("From Date and To Date are required"))

    if getdate(doc.from_date) != getdate(doc.to_date):
        frappe.throw(_("Short Leave must be applied for a single day"))

    this_hours = _hours(from_time, to_time)
    if this_hours <= 0:
        frappe.throw(_("To Hours must be after From Hours"))

    leave_date = getdate(doc.from_date)
    rows = _used_rows(doc.employee, leave_date, exclude=None if doc.is_new() else doc.name)

    used = 0.0
    for r in rows:
        if not (r.get(FROM_FIELD) and r.get(TO_FIELD)):
            continue

        # overlap check on the same day
        if getdate(r.from_date) == leave_date:
            s, e = to_timedelta(r[FROM_FIELD]), to_timedelta(r[TO_FIELD])
            if to_timedelta(from_time) < e and s < to_timedelta(to_time):
                frappe.throw(_("Short Leave overlaps with {0}").format(r.name))

        used += _hours(r[FROM_FIELD], r[TO_FIELD])

    balance = MAX_HOURS_PER_MONTH - used

    if flt(this_hours, 2) > flt(balance, 2):
        frappe.throw(
            _("Short Leave limit is {0} hrs per month. Already used: {1} hrs. Remaining: {2} hrs. This request is {3} hrs.").format(
                MAX_HOURS_PER_MONTH, flt(used, 2), flt(balance, 2), flt(this_hours, 2)
            )
        )


@frappe.whitelist()
def get_short_leave_balance(employee, date):
    rows = _used_rows(employee, getdate(date))
    used = sum(
        _hours(r[FROM_FIELD], r[TO_FIELD])
        for r in rows
        if r.get(FROM_FIELD) and r.get(TO_FIELD)
    )
    return {
        "limit": MAX_HOURS_PER_MONTH,
        "used": flt(used, 2),
        "balance": flt(MAX_HOURS_PER_MONTH - used, 2),
    }


# ------------------------- class override: Total Leave Days = hours taken
class CustomLeaveApplication(LeaveApplication):
    def validate_balance_leaves(self):
        if self.leave_type != SHORT_LEAVE_TYPE:
            return super().validate_balance_leaves()

        # 0.5 hr -> 0.5, 1 hr -> 1, 2 hrs -> 2
        self.total_leave_days = flt(
            _hours(self.get(FROM_FIELD), self.get(TO_FIELD)), 2
        )
        if self.total_leave_days <= 0:
            frappe.throw(_("To Hours must be after From Hours"))

        self.leave_balance = get_leave_balance_on(
            self.employee,
            self.leave_type,
            self.from_date,
            self.to_date,
            consider_all_leaves_in_the_allocation_period=True,
        )

        allow_negative = frappe.db.get_value(
            "Leave Type", self.leave_type, "allow_negative"
        )
        if (
            self.status != "Rejected"
            and not allow_negative
            and flt(self.leave_balance, 2) < flt(self.total_leave_days, 2)
        ):
            frappe.throw(
                _("Insufficient Short Leave balance. Available: {0} hrs, requested: {1} hrs.").format(
                    flt(self.leave_balance, 2), flt(self.total_leave_days, 2)
                )
            )


# ------------------------------- monthly auto allocation (scheduler event)
def allocate_short_leave():
    today = getdate()
    start, end = get_first_day(today), get_last_day(today)

    for emp in frappe.get_all("Employee", filters={"status": "Active"}, pluck="name"):
        if frappe.db.exists(
            "Leave Allocation",
            {
                "employee": emp,
                "leave_type": SHORT_LEAVE_TYPE,
                "from_date": start,
                "docstatus": 1,
            },
        ):
            continue

        la = frappe.get_doc(
            {
                "doctype": "Leave Allocation",
                "employee": emp,
                "leave_type": SHORT_LEAVE_TYPE,
                "from_date": start,
                "to_date": end,
                "new_leaves_allocated": MAX_HOURS_PER_MONTH,
            }
        )
        la.insert()
        la.submit()