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


def set_sales_team_allocation(doc, method=None):
    rows = doc.get("sales_team") or []
    if not rows:
        return

    groups = {}
    for r in rows:
        groups.setdefault(r.sales_person or "", []).append(r)

    for sales_person, group_rows in groups.items():
        total = sum(flt(r.custom_target_value) for r in group_rows)
        if total <= 0:
            continue

        for r in group_rows:
            r.allocated_percentage = flt(flt(r.custom_target_value) / total * 100, 2)

        diff = flt(100 - sum(flt(r.allocated_percentage) for r in group_rows), 2)
        if diff:
            biggest = max(group_rows, key=lambda r: flt(r.custom_target_value))
            biggest.allocated_percentage = flt(biggest.allocated_percentage + diff, 2)


@frappe.whitelist()
def get_customer_sales_team(customer, customer_address=None):
    if not customer or not customer_address:
        return []

    frappe.has_permission("Customer", "read", customer, throw=True)

    return frappe.get_all(
        "Sales Team",
        filters={
            "parent": customer,
            "parenttype": "Customer",
            "parentfield": "sales_team",
            "custom_address": customer_address,
        },
        fields=[
            "sales_person",
            "custom_factor",
            "custom_frequency",
            "custom_target_value",
            "custom_address",
            "allocated_percentage",
        ],
        order_by="idx asc",
    )