import frappe
from frappe.utils import flt

FREIGHT_ACCOUNT_NAME = "Freight and Forwarding Charges"
ADDITIONAL_CHARGES_ACCOUNT_NAME = "Additional Charges"


def get_or_create_account(account_name, company):
    abbr = frappe.db.get_value("Company", company, "abbr")
    account_head = f"{account_name} - {abbr}"

    if frappe.db.exists("Account", account_head):
        return account_head

    parent_account = frappe.db.get_value(
        "Account",
        {"company": company, "account_name": "Indirect Expenses", "is_group": 1},
        "name"
    )
    if not parent_account:
        parent_account = frappe.db.get_value(
            "Account",
            {"company": company, "root_type": "Expense", "is_group": 1},
            "name"
        )

    account = frappe.get_doc({
        "doctype": "Account",
        "account_name": account_name,
        "company": company,
        "parent_account": parent_account,
        "account_type": "Chargeable",
        "is_group": 0
    })
    account.insert(ignore_permissions=True)
    return account.name

def handle_transportation_item(doc, method=None):
    freight_account = get_or_create_account(FREIGHT_ACCOUNT_NAME, doc.company)
    additional_account = get_or_create_account(ADDITIONAL_CHARGES_ACCOUNT_NAME, doc.company)

    should_have_freight = (
        doc.custom_transportation_arrange_by == "Supplier"
        and flt(doc.custom_transportation_cost) > 0
    )
    should_have_additional = (
        doc.custom_additional_charges == "Yes"
        and flt(doc.custom_total_additional_charges) > 0
    )

    transportation_amount = flt(doc.custom_transportation_cost) if should_have_freight else 0
    additional_amount = flt(doc.custom_total_additional_charges) if should_have_additional else 0
    doc.custom_gross_total = transportation_amount + additional_amount + flt(doc.net_total)
    doc.custom_custom_duty_amount = flt(doc.custom_gross_total) * flt(doc.custom_custom_duty_percentage) / 100
    doc.custom_social_welfare_fund_amount = flt(doc.custom_custom_duty_amount) * flt(doc.custom_social_welfare_fund_percentage) / 100

    doc.custom_total_landing_cost = (
        flt(doc.custom_gross_total)
        + flt(doc.custom_custom_duty_amount)
        + flt(doc.custom_social_welfare_fund_amount)
        + flt(doc.custom_custom_clearence)
        + flt(doc.custom_seaair_to_port_to_nmtg_works__freight)
    )
    doc.custom_per_unit_landing_cost = (
        flt(doc.custom_total_landing_cost) / flt(doc.total_qty)
        if flt(doc.total_qty) else 0
    )

    doc.taxes = [t for t in doc.taxes if t.account_head not in (freight_account, additional_account)]

    charge_entries = []
    if should_have_additional:
        charge_entries.append((additional_account, ADDITIONAL_CHARGES_ACCOUNT_NAME, doc.custom_total_additional_charges))
    if should_have_freight:
        charge_entries.append((freight_account, FREIGHT_ACCOUNT_NAME, doc.custom_transportation_cost))

    for account_head, description, amount in reversed(charge_entries):
        new_row = doc.append("taxes", {
            "category": "Total",
            "add_deduct_tax": "Add",
            "charge_type": "Actual",
            "account_head": account_head,
            "description": description,
            "tax_amount": flt(amount)
        })
        doc.taxes.remove(new_row)
        doc.taxes.insert(0, new_row)

    for i, row in enumerate(doc.taxes, start=1):
        row.idx = i

    last_charge_idx = len(charge_entries) if charge_entries else None
    for row in doc.taxes:
        if row.account_head in (freight_account, additional_account):
            continue
        if row.charge_type in ("On Previous Row Total", "On Previous Row Amount", "On Net Total"):
            if last_charge_idx:
                row.charge_type = "On Previous Row Total"
                row.row_id = str(last_charge_idx)
            else:
                row.charge_type = "On Net Total"
                row.row_id = ""

    doc.calculate_taxes_and_totals()