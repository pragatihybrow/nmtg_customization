import frappe
from erpnext.crm.doctype.opportunity.opportunity import Opportunity
from erpnext.setup.utils import get_exchange_rate
from frappe.model.mapper import get_mapped_doc


class CustomOpportunity(Opportunity):
    def validate(self):
        super().validate()
        self.set_customer_codes()

    def set_customer_codes(self):
        if self.opportunity_from != "Customer" or not self.party_name:
            return

        item_codes = list({row.item_code for row in self.items if row.item_code})
        if not item_codes:
            return

        rows = frappe.db.get_all(
            "Item Customer Detail",
            filters={
                "parenttype": "Item",
                "parentfield": "customer_items",
                "parent": ["in", item_codes],
                "customer_name": self.party_name,
            },
            fields=["parent as item_code", "ref_code"],
        )
        ref_code_map = {r.item_code: r.ref_code for r in rows}

        for row in self.items:
            row.custom_customer_code = ref_code_map.get(row.item_code, "")

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
                "primary_contact",
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
                    "primary_contact": row.primary_contact or 0,
                },
            )


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


def _in_nmtg_scope(item):
    return not frappe.utils.cint(item.get("custom_not_in_nmtg_scope"))


@frappe.whitelist()
def make_quotation(source_name, target_doc=None):
    def set_missing_values(source, target):
        from erpnext.controllers.accounts_controller import (
            get_default_taxes_and_charges,
        )

        quotation = frappe.get_doc(target)

        company_currency = frappe.get_cached_value(
            "Company", quotation.company, "default_currency"
        )

        if company_currency == quotation.currency:
            exchange_rate = 1
        else:
            exchange_rate = get_exchange_rate(
                quotation.currency,
                company_currency,
                quotation.transaction_date,
                args="for_selling",
            )

        quotation.conversion_rate = exchange_rate

        taxes = get_default_taxes_and_charges(
            "Sales Taxes and Charges Template", company=quotation.company
        )
        if taxes.get("taxes"):
            quotation.update(taxes)

        quotation.run_method("set_missing_values")
        quotation.run_method("calculate_taxes_and_totals")

        # `with_items` may not exist on this site's Opportunity (removed/renamed
        # in newer versions). If it's absent, fall back to "no in-scope items
        # were mapped", which is the case the link is meant to cover.
        if hasattr(source, "with_items"):
            has_items = bool(source.with_items)
        else:
            has_items = bool(quotation.get("items"))

        if not has_items:
            quotation.opportunity = source.name

    return get_mapped_doc(
        "Opportunity",
        source_name,
        {
            "Opportunity": {
                "doctype": "Quotation",
                "field_map": {"opportunity_from": "quotation_to", "name": "enq_no"},
            },
            "Opportunity Item": {
                "doctype": "Quotation Item",
                "field_map": {
                    "parent": "prevdoc_docname",
                    "parenttype": "prevdoc_doctype",
                    "uom": "stock_uom",
                },
                "add_if_empty": True,
                "condition": _in_nmtg_scope,
            },
        },
        target_doc,
        set_missing_values,
    )


@frappe.whitelist()
def make_request_for_quotation(source_name, target_doc=None):
    return get_mapped_doc(
        "Opportunity",
        source_name,
        {
            "Opportunity": {"doctype": "Request for Quotation"},
            "Opportunity Item": {
                "doctype": "Request for Quotation Item",
                "field_map": [
                    ["name", "opportunity_item"],
                    ["parent", "opportunity"],
                    ["uom", "uom"],
                ],
                "condition": _in_nmtg_scope,
            },
        },
        target_doc,
    )


@frappe.whitelist()
def make_supplier_quotation(source_name, target_doc=None):
    return get_mapped_doc(
        "Opportunity",
        source_name,
        {
            "Opportunity": {
                "doctype": "Supplier Quotation",
                "field_map": {"name": "opportunity"},
            },
            "Opportunity Item": {
                "doctype": "Supplier Quotation Item",
                "field_map": {"uom": "stock_uom"},
                "condition": _in_nmtg_scope,
            },
        },
        target_doc,
    )