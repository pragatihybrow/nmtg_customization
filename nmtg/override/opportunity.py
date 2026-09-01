import frappe
from erpnext.crm.doctype.opportunity.opportunity import Opportunity


class CustomOpportunity(Opportunity):
    def before_insert(self):
        self.sync_contact_from_lead()

    def sync_contact_from_lead(self):
        if (
            self.opportunity_from != "Lead"
            or not self.party_name
            or self.custom_contact
        ):
            return

        lead_contacts = frappe.get_all(
            "Lead Contact Info",
            filters={
                "parent": self.party_name,
                "parenttype": "Lead",
                "parentfield": "custom_contact_info",
            },
            fields=[
                "name1",
                "designation",
                "email_id",
                "contact_no",
                "whatsapp_no",
                "custom_contact_ref",
            ],
            order_by="idx",
        )

        for row in lead_contacts:
            self.append(
                "custom_contact",
                {
                    "name1": row.name1,
                    "designation": row.designation,
                    "email_id": row.email_id,
                    "contact_no": row.contact_no,
                    "whatsapp_no": row.whatsapp_no,
                    "custom_contact_ref": row.custom_contact_ref,
                },
            )

# nmtg/override/opportunity.py

import frappe


def set_contact_recipient_emails(doc, method=None):
    primary_email = ""
    cc_emails = []

    for row in doc.get("custom_contact") or []:
        if not row.email_id:
            continue
        if row.primary_contact and not primary_email:
            primary_email = row.email_id
        else:
            cc_emails.append(row.email_id)

    if not primary_email and cc_emails:
        primary_email = cc_emails.pop(0)

    if doc.opportunity_owner:
        owner_email = frappe.db.get_value("User", doc.opportunity_owner, "email")
        if owner_email and owner_email not in cc_emails:
            cc_emails.append(owner_email)

    doc.custom_primary_contact_email = primary_email
    doc.custom_other_contact_emails = ", ".join(cc_emails)