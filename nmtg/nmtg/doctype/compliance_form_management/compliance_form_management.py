

# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from nmtg.nmtg.doctype.compliance_form.compliance_form import get_next_due_date


class ComplianceFormManagement(Document):
    def validate(self):
        for row in self.compliance_forms:
            if not (row.compliance_form and row.submitted_form_date):
                row.next_submission_due_date = None
                continue

            form = frappe.get_doc("Compliance Form", row.compliance_form)
            if not form.notifications:
                frappe.throw(
                    f"Row {row.idx}: {row.compliance_form} has no Notifications configured."
                )

            row.next_submission_due_date = get_next_due_date(
                row.submitted_form_date, form.notifications[0].submission_frequency
            )

from frappe.utils import getdate, today
from nmtg.nmtg.doctype.compliance_form.compliance_form import (
    get_notification_date,
    get_next_due_date,
)


def send_compliance_notifications():
    today_date = getdate(today())

    rows = frappe.get_all(
        "Compliance Form Management Item",  # use your exact child doctype name
        filters={"submitted_form_date": ["is", "set"]},
        fields=["name", "parent", "compliance_form", "submitted_form_date"],
    )

    for row in rows:
        form = frappe.get_doc("Compliance Form", row.compliance_form)

        for n in form.notifications:
            if not n.send_to:
                continue

            notify_date = get_notification_date(
                row.submitted_form_date,
                n.submission_frequency,
                n.send_notification_on,
            )

            if notify_date != today_date:
                continue

            due_date = get_next_due_date(row.submitted_form_date, n.submission_frequency)

            # Avoid duplicates if the job runs twice in one day
            subject = f"Compliance Form Due: {form.compliance_form_name} on {due_date}"
            already_sent = frappe.db.exists(
                "Notification Log",
                {
                    "for_user": n.send_to,
                    "document_type": "Compliance Form Management",
                    "document_name": row.parent,
                    "subject": subject,
                    "creation": [">=", today_date],
                },
            )
            if already_sent:
                continue

            frappe.get_doc(
                {
                    "doctype": "Notification Log",
                    "for_user": n.send_to,
                    "type": "Alert",
                    "subject": subject,
                    "email_content": (
                        f"{form.compliance_form_name} is due on {due_date}. "
                        f"Last submitted: {row.submitted_form_date}."
                    ),
                    "document_type": "Compliance Form Management",
                    "document_name": row.parent,
                }
            ).insert(ignore_permissions=True)

    frappe.db.commit()            