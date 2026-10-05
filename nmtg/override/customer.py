import frappe
from frappe import _
from frappe.utils import flt
from erpnext.selling.doctype.customer.customer import Customer


class CustomCustomer(Customer):
    def validate(self):
        self.validate_sales_team()
        sales_team = self.sales_team
        self.sales_team = []
        try:
            super().validate()
        finally:
            self.sales_team = sales_team

    def validate_sales_team(self):
        rows = self.get("sales_team") or []
        if not rows:
            return

        totals = {}
        for r in rows:
            key = r.sales_person or ""
            totals[key] = totals.get(key, 0) + flt(r.allocated_percentage)

        for sales_person, total in totals.items():
            if abs(flt(total, 2) - 100) > 0.01:
                frappe.throw(
                    _("Total contribution percentage for Sales Person {0} should be equal to 100").format(
                        frappe.bold(sales_person or _("(blank)"))
                    )
                )


# @frappe.whitelist()
# def get_customer_sales_team(customer, customer_address):
#     if not customer or not customer_address:
#         return []

#     return frappe.get_all(
#         "Sales Team",
#         filters={
#             "parenttype": "Customer",
#             "parent": customer,
#             "parentfield": "sales_team",
#             "custom_address": customer_address,
#         },
#         fields=["sales_person", "custom_address", "allocated_percentage"],
#         order_by="idx asc",
#     )


def _get_address_sales_team(customer, customer_address):
    if not customer or not customer_address:
        return []

    return frappe.get_all(
        "Sales Team",
        filters={
            "parenttype": "Customer",
            "parent": customer,
            "parentfield": "sales_team",
            "custom_address": customer_address,
        },
        fields=["sales_person", "custom_address", "allocated_percentage"],
        order_by="idx asc",
    )


@frappe.whitelist()
def get_customer_sales_team(customer, customer_address):
    return _get_address_sales_team(customer, customer_address)


def filter_sales_team_by_address(doc, method=None):
    """Sales Order before_validate: keep only the sales persons linked to the selected address."""
    if doc.docstatus != 0:
        return

    if not doc.customer or not doc.customer_address:
        doc.set("sales_team", [])
        return

    team = _get_address_sales_team(doc.customer, doc.customer_address)

    doc.set("sales_team", [])
    for src in team:
        doc.append(
            "sales_team",
            {
                "sales_person": src.sales_person,
                "custom_address": src.custom_address,
                "allocated_percentage": src.allocated_percentage,
            },
        )