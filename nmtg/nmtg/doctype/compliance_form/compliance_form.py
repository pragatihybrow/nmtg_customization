# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
import frappe
from frappe.model.document import Document
from frappe.utils import add_months, add_days, getdate

FREQUENCY_MONTHS = {
    "Monthly": 1,
    "Bimonthly": 2,
    "Quarterly": 3,
    "BiYearly": 6,
    "Yearly": 12,
}


def get_next_due_date(submitted_date, frequency):
    # add_months handles 28/29/30/31-day months (31 Jan + 1 month = 28/29 Feb)
    return add_months(getdate(submitted_date), FREQUENCY_MONTHS[frequency])


def get_notification_date(submitted_date, frequency, offset):
    offset = int(offset or 0)
    if offset == 0:
        return getdate(submitted_date)  # on the submitted form date
    due = get_next_due_date(submitted_date, frequency)
    return add_days(due, offset)  # -15 = 15 days before due date


class ComplianceForm(Document):
    def validate(self):
        frequencies = {r.submission_frequency for r in self.notifications}
        if len(frequencies) > 1:
            frappe.throw("All Notification rows must have the same Submission Frequency.")