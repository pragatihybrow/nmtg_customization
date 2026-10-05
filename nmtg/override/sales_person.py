import frappe
from frappe import _


def validate_sales_person_weightage(doc, method=None):
    total_weightage = sum(
        frappe.utils.flt(row.weightage)
        for row in doc.get("custom_sales_target") or []
    )

    if total_weightage != 100:
        frappe.throw(
            _("Total Weightage must be exactly 100%. Current total is {0}%.").format(
                total_weightage
            )
        )