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