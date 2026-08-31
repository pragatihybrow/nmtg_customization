# import frappe
# from frappe.utils import flt

# FREIGHT_ACCOUNT_NAME = "Freight and Forwarding Charges"
# ADDITIONAL_CHARGES_ACCOUNT_NAME = "Additional Charges"
# CUSTOM_DUTY_ACCOUNT_NAME = "Custom Duty"
# SOCIAL_WELFARE_FUND_ACCOUNT_NAME = "Social Welfare Fund"
# CUSTOM_CLEARANCE_ACCOUNT_NAME = "Custom Clearance"
# SEA_AIR_FREIGHT_ACCOUNT_NAME = "Sea/Air To Port To NMTG Works - Freight"

# ALL_CHARGE_ACCOUNT_NAMES = [
#     FREIGHT_ACCOUNT_NAME,
#     ADDITIONAL_CHARGES_ACCOUNT_NAME,
#     CUSTOM_DUTY_ACCOUNT_NAME,
#     SOCIAL_WELFARE_FUND_ACCOUNT_NAME,
#     CUSTOM_CLEARANCE_ACCOUNT_NAME,
#     SEA_AIR_FREIGHT_ACCOUNT_NAME,
# ]

# GST_BASE_ACCOUNT_NAMES = {ADDITIONAL_CHARGES_ACCOUNT_NAME, FREIGHT_ACCOUNT_NAME}


# def get_or_create_account(account_name, company):
#     abbr = frappe.db.get_value("Company", company, "abbr")
#     account_head = f"{account_name} - {abbr}"

#     if frappe.db.exists("Account", account_head):
#         return account_head

#     parent_account = frappe.db.get_value(
#         "Account",
#         {"company": company, "account_name": "Indirect Expenses", "is_group": 1},
#         "name"
#     )
#     if not parent_account:
#         parent_account = frappe.db.get_value(
#             "Account",
#             {"company": company, "root_type": "Expense", "is_group": 1},
#             "name"
#         )

#     account = frappe.get_doc({
#         "doctype": "Account",
#         "account_name": account_name,
#         "company": company,
#         "parent_account": parent_account,
#         "account_type": "Chargeable",
#         "is_group": 0
#     })
#     account.insert(ignore_permissions=True)
#     return account.name


# def handle_transportation_item(doc, method=None):
#     accounts = {
#         name: get_or_create_account(name, doc.company)
#         for name in ALL_CHARGE_ACCOUNT_NAMES
#     }

#     # International suppliers: no domestic GST category/template applies —
#     # customs duty/SWF/clearance (computed below) are the correct charges instead.
#     if doc.custom_supplier_scope == "International":
#         doc.tax_category = ""
#         doc.taxes_and_charges = ""

#     should_have_freight = (
#         doc.custom_transportation_arrange_by == "Supplier"
#         and flt(doc.custom_transportation_cost) > 0
#     )
#     should_have_additional = (
#         doc.custom_additional_charges == "Yes"
#         and flt(doc.custom_total_additional_charges) > 0
#     )

#     transportation_amount = flt(doc.custom_transportation_cost) if should_have_freight else 0
#     additional_amount = flt(doc.custom_total_additional_charges) if should_have_additional else 0
#     doc.custom_gross_total = transportation_amount + additional_amount + flt(doc.net_total)
#     doc.custom_custom_duty_amount = flt(doc.custom_gross_total) * flt(doc.custom_custom_duty_percentage) / 100
#     doc.custom_social_welfare_fund_amount = flt(doc.custom_custom_duty_amount) * flt(doc.custom_social_welfare_fund_percentage) / 100

#     doc.custom_total_landing_cost = (
#         flt(doc.custom_gross_total)
#         + flt(doc.custom_custom_duty_amount)
#         + flt(doc.custom_social_welfare_fund_amount)
#         + flt(doc.custom_custom_clearence)
#         + flt(doc.custom_seaair_to_port_to_nmtg_works__freight)
#     )
#     doc.custom_per_unit_landing_cost = (
#         flt(doc.custom_total_landing_cost) / flt(doc.total_qty)
#         if flt(doc.total_qty) else 0
#     )

#     managed_account_heads = set(accounts.values())
#     doc.taxes = [t for t in doc.taxes if t.account_head not in managed_account_heads]

#     charge_entries = []
#     if should_have_additional:
#         charge_entries.append((ADDITIONAL_CHARGES_ACCOUNT_NAME, accounts[ADDITIONAL_CHARGES_ACCOUNT_NAME], additional_amount))
#     if should_have_freight:
#         charge_entries.append((FREIGHT_ACCOUNT_NAME, accounts[FREIGHT_ACCOUNT_NAME], transportation_amount))
#     if flt(doc.custom_custom_duty_amount) > 0:
#         charge_entries.append((CUSTOM_DUTY_ACCOUNT_NAME, accounts[CUSTOM_DUTY_ACCOUNT_NAME], doc.custom_custom_duty_amount))
#     if flt(doc.custom_social_welfare_fund_amount) > 0:
#         charge_entries.append((SOCIAL_WELFARE_FUND_ACCOUNT_NAME, accounts[SOCIAL_WELFARE_FUND_ACCOUNT_NAME], doc.custom_social_welfare_fund_amount))
#     if flt(doc.custom_custom_clearence) > 0:
#         charge_entries.append((CUSTOM_CLEARANCE_ACCOUNT_NAME, accounts[CUSTOM_CLEARANCE_ACCOUNT_NAME], doc.custom_custom_clearence))
#     if flt(doc.custom_seaair_to_port_to_nmtg_works__freight) > 0:
#         charge_entries.append((SEA_AIR_FREIGHT_ACCOUNT_NAME, accounts[SEA_AIR_FREIGHT_ACCOUNT_NAME], doc.custom_seaair_to_port_to_nmtg_works__freight))

#     for name, account_head, amount in reversed(charge_entries):
#         new_row = doc.append("taxes", {
#             "category": "Total",
#             "add_deduct_tax": "Add",
#             "charge_type": "Actual",
#             "account_head": account_head,
#             "description": name,
#             "tax_amount": flt(amount)
#         })
#         doc.taxes.remove(new_row)
#         doc.taxes.insert(0, new_row)

#     for i, row in enumerate(doc.taxes, start=1):
#         row.idx = i

    
#     gst_base_idx = None
#     for i, (name, account_head, amount) in enumerate(charge_entries, start=1):
#         if name in GST_BASE_ACCOUNT_NAMES:
#             gst_base_idx = i

#     for row in doc.taxes:
#         if row.account_head in managed_account_heads:
#             continue
#         if row.charge_type in ("On Previous Row Total", "On Previous Row Amount", "On Net Total"):
#             if gst_base_idx:
#                 row.charge_type = "On Previous Row Total"
#                 row.row_id = str(gst_base_idx)
#             else:
#                 row.charge_type = "On Net Total"
#                 row.row_id = ""

#     doc.calculate_taxes_and_totals()

#     gst_total = sum(
#         flt(row.tax_amount) for row in doc.taxes
#         if row.account_head not in managed_account_heads
#     )
#     doc.custom_total_landing_cost = flt(doc.custom_total_landing_cost) + gst_total
#     doc.custom_per_unit_landing_cost = (
#         flt(doc.custom_total_landing_cost) / flt(doc.total_qty)
#         if flt(doc.total_qty) else 0
#     )


import frappe
from frappe.utils import flt

FREIGHT_ACCOUNT_NAME = "Freight and Forwarding Charges"
ADDITIONAL_CHARGES_ACCOUNT_NAME = "Additional Charges"
CUSTOM_DUTY_ACCOUNT_NAME = "Custom Duty"
SOCIAL_WELFARE_FUND_ACCOUNT_NAME = "Social Welfare Fund"
CUSTOM_CLEARANCE_ACCOUNT_NAME = "Custom Clearance"
SEA_AIR_FREIGHT_ACCOUNT_NAME = "Sea/Air To Port To NMTG Works - Freight"

ALL_CHARGE_ACCOUNT_NAMES = [
    FREIGHT_ACCOUNT_NAME,
    ADDITIONAL_CHARGES_ACCOUNT_NAME,
    CUSTOM_DUTY_ACCOUNT_NAME,
    SOCIAL_WELFARE_FUND_ACCOUNT_NAME,
    CUSTOM_CLEARANCE_ACCOUNT_NAME,
    SEA_AIR_FREIGHT_ACCOUNT_NAME,
]

# Only these two feed the GST base (Gross Amount) — import charges do not
GST_BASE_ACCOUNT_NAMES = {ADDITIONAL_CHARGES_ACCOUNT_NAME, FREIGHT_ACCOUNT_NAME}


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
    accounts = {
        name: get_or_create_account(name, doc.company)
        for name in ALL_CHARGE_ACCOUNT_NAMES
    }

    # International suppliers: no domestic GST category/template applies —
    # customs duty/SWF/clearance (computed below) are the correct charges instead.
    if doc.custom_supplier_scope == "International":
        doc.tax_category = ""
        doc.taxes_and_charges = ""

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

    # Landed Cost = Gross Amount + import charges only. GST is never part of this —
    # it's a recoverable input tax, tracked separately via grand_total/taxes table.
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

    # strip out all managed charge rows — rebuilt below in order
    managed_account_heads = set(accounts.values())
    doc.taxes = [t for t in doc.taxes if t.account_head not in managed_account_heads]

    # build in required sequence: Additional Charges, Freight, Custom Duty, SWF, Custom Clearance, Sea/Air Freight
    charge_entries = []
    if should_have_additional:
        charge_entries.append((ADDITIONAL_CHARGES_ACCOUNT_NAME, accounts[ADDITIONAL_CHARGES_ACCOUNT_NAME], additional_amount))
    if should_have_freight:
        charge_entries.append((FREIGHT_ACCOUNT_NAME, accounts[FREIGHT_ACCOUNT_NAME], transportation_amount))
    if flt(doc.custom_custom_duty_amount) > 0:
        charge_entries.append((CUSTOM_DUTY_ACCOUNT_NAME, accounts[CUSTOM_DUTY_ACCOUNT_NAME], doc.custom_custom_duty_amount))
    if flt(doc.custom_social_welfare_fund_amount) > 0:
        charge_entries.append((SOCIAL_WELFARE_FUND_ACCOUNT_NAME, accounts[SOCIAL_WELFARE_FUND_ACCOUNT_NAME], doc.custom_social_welfare_fund_amount))
    if flt(doc.custom_custom_clearence) > 0:
        charge_entries.append((CUSTOM_CLEARANCE_ACCOUNT_NAME, accounts[CUSTOM_CLEARANCE_ACCOUNT_NAME], doc.custom_custom_clearence))
    if flt(doc.custom_seaair_to_port_to_nmtg_works__freight) > 0:
        charge_entries.append((SEA_AIR_FREIGHT_ACCOUNT_NAME, accounts[SEA_AIR_FREIGHT_ACCOUNT_NAME], doc.custom_seaair_to_port_to_nmtg_works__freight))

    # insert them at the very front of the taxes table, in order
    for name, account_head, amount in reversed(charge_entries):
        new_row = doc.append("taxes", {
            "category": "Total",
            "add_deduct_tax": "Add",
            "charge_type": "Actual",
            "account_head": account_head,
            "description": name,
            "tax_amount": flt(amount)
        })
        doc.taxes.remove(new_row)
        doc.taxes.insert(0, new_row)

    # renumber idx to reflect actual position
    for i, row in enumerate(doc.taxes, start=1):
        row.idx = i

    # GST base = last of ONLY the Additional Charges / Freight rows (Gross Amount), not the import charges
    # (only relevant when a GST template is actually applied — i.e. Domestic scope)
    gst_base_idx = None
    for i, (name, account_head, amount) in enumerate(charge_entries, start=1):
        if name in GST_BASE_ACCOUNT_NAMES:
            gst_base_idx = i

    for row in doc.taxes:
        if row.account_head in managed_account_heads:
            continue
        if row.charge_type in ("On Previous Row Total", "On Previous Row Amount", "On Net Total"):
            if gst_base_idx:
                row.charge_type = "On Previous Row Total"
                row.row_id = str(gst_base_idx)
            else:
                row.charge_type = "On Net Total"
                row.row_id = ""

    doc.calculate_taxes_and_totals()