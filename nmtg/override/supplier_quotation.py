import frappe
from frappe.utils import flt

FREIGHT_ACCOUNT_NAME = "Freight and Forwarding Charges"
ADDITIONAL_CHARGES_ACCOUNT_NAME = "Additional Charges"

ALL_CHARGE_ACCOUNT_NAMES = [
    FREIGHT_ACCOUNT_NAME,
    ADDITIONAL_CHARGES_ACCOUNT_NAME,
]

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



    should_have_freight = (
        doc.custom_transportation_arrange_by == "Supplier"
        and flt(doc.custom_transportation_cost) > 0
    )
    should_have_additional = (
        doc.custom_additional_charges == "Yes"
        and flt(doc.custom_total_additional_charges) > 0
    )

    transportation_amount = flt(doc.custom_transportation_cost) #if should_have_freight else 0
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

    managed_account_heads = set(accounts.values())
    doc.taxes = [t for t in doc.taxes if t.account_head not in managed_account_heads]

    charge_entries = []
    if should_have_additional:
        charge_entries.append((ADDITIONAL_CHARGES_ACCOUNT_NAME, accounts[ADDITIONAL_CHARGES_ACCOUNT_NAME], additional_amount))
    if should_have_freight:
        charge_entries.append((FREIGHT_ACCOUNT_NAME, accounts[FREIGHT_ACCOUNT_NAME], transportation_amount))
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

    for i, row in enumerate(doc.taxes, start=1):
        row.idx = i

   
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

HEADER_TO_ITEM_FIELDS = [
    # Subcontracting
    "custom_job_work_rate_basis",
    "custom_job_work__process_name",
    "custom_return_lead_time",
    "custom_scrap__rejection_responsibility",
    # Rate Contract
    "custom_estimated_monthly_qty",
    "custom_order_release_method",
    "custom_termination_notice_period",
    "custom_days",
    # Service
    "custom_service_type",
    "custom_other_service_type",
    "custom_service_location",
    "custom_service_duration",
    "custom_manpower_requirement",
    "custom_travel__boarding__lodging",
    # Asset Purchase
    "custom_asset_type",
    "custom_installation_required",
    "custom_commissioning_required",
    "custom_training_required",
    # Other
    "custom_other_purchase_type",
]

def copy_header_fields_to_items(doc, method):
    if not doc.get("items") or not doc.get("custom_rfq"):
        return

    rfq_values = frappe.db.get_value(
        "Request for Quotation",
        doc.custom_rfq,
        HEADER_TO_ITEM_FIELDS,
        as_dict=True,
    )
    if not rfq_values:
        return

    for item in doc.items:
        for fieldname in HEADER_TO_ITEM_FIELDS:
            if not item.get(fieldname) and rfq_values.get(fieldname):
                item.set(fieldname, rfq_values.get(fieldname))