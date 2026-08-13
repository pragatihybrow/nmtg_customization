# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Enquiry(Document):
	pass


@frappe.whitelist()
def create_opportunity(enquiry):
    enq = frappe.get_doc("Enquiry", enquiry)

    opp = frappe.new_doc("Opportunity")
    opp.opportunity_from = "Enquiry"
    opp.party_name = enq.name
    opp.customer_name = enq.organization_name
    opp.opportunity_owner = frappe.session.user

    opp.custom_annual_turnover_ = enq.annual_turnover
    opp.custom_approx_annual_requirement = enq.approx_annual_requirement
    opp.custom_requirement_timeline = enq.requirement_timeline
    opp.territory = enq.territory
    opp.company_name = enq.organization_name

    opp.insert(ignore_permissions=True)

    return opp.name
