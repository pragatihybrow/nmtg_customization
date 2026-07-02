import frappe
from frappe.model.document import Document
from frappe.utils import getdate, nowdate, flt
from calendar import monthrange


QUALITY_WEIGHT = 0.5
DELIVERY_WEIGHT = 0.5


class SupplierPerformanceSummary(Document):
    pass


def create_monthly_supplier_performance():
    today = getdate(nowdate())

    # Current month (testing)
    # current_month = today

    # Last month (for live)
    from frappe.utils import add_months
    current_month = add_months(today, -1)

    evaluation_month = current_month.strftime("%B %Y")

    start_date = current_month.replace(day=1)
    end_date = current_month.replace(
        day=monthrange(current_month.year, current_month.month)[1]
    )

    suppliers = frappe.db.sql("""
        SELECT DISTINCT supplier
        FROM `tabPurchase Receipt`
        WHERE docstatus = 1
        AND posting_date BETWEEN %s AND %s
        AND supplier IS NOT NULL
    """, (start_date, end_date), as_dict=True)

    for row in suppliers:
        supplier = row.supplier

        # Skip duplicate
        if frappe.db.exists(
            "Supplier Performance Summary",
            {
                "supplier_name": supplier,
                "evaluation_month": evaluation_month
            }
        ):
            continue

        receipts = frappe.db.sql("""
            SELECT
                pri.qty,
                pri.rejected_qty,
                pri.schedule_date,
                pr.posting_date
            FROM `tabPurchase Receipt` pr
            INNER JOIN `tabPurchase Receipt Item` pri
                ON pri.parent = pr.name
            WHERE
                pr.docstatus = 1
                AND pr.supplier = %s
                AND pr.posting_date BETWEEN %s AND %s
        """, (supplier, start_date, end_date), as_dict=True)

        total_deliveries = 0
        accepted_deliveries = 0
        rejected_deliveries = 0
        on_time_delivery = 0
        off_time_delivery = 0
        total_ordered_qty = 0
        total_rejected_qty = 0

        for receipt in receipts:
            total_deliveries += 1
            total_ordered_qty += flt(receipt.qty)
            total_rejected_qty += flt(receipt.rejected_qty)

            if flt(receipt.rejected_qty) == 0:
                accepted_deliveries += 1
            else:
                rejected_deliveries += 1

            if (
                not receipt.schedule_date
                or getdate(receipt.posting_date) <= getdate(receipt.schedule_date)
            ):
                on_time_delivery += 1
            else:
                off_time_delivery += 1

        # Fetch CAPA count for supplier
        capa_cases_count = frappe.db.count(
            "CAPA Report",
            {
                "external_provider_name": supplier,
                "date": ["between", [start_date, end_date]]
            }
        )

        quality_score = (
            flt((accepted_deliveries / total_deliveries) * 100, 2)
            if total_deliveries else 0
        )

        on_time_delivery_score = (
            flt((on_time_delivery / total_deliveries) * 100, 2)
            if total_deliveries else 0
        )

        ppm_score = (
            flt((total_rejected_qty / total_ordered_qty) * 1000000, 0)
            if total_ordered_qty else 0
        )

        overall_supplier_rating = flt(
            (quality_score * QUALITY_WEIGHT) +
            (on_time_delivery_score * DELIVERY_WEIGHT),
            2
        )

        performance_grade = get_rating(overall_supplier_rating)

        doc = frappe.get_doc({
            "doctype": "Supplier Performance Summary",
            "supplier_name": supplier,
            "evaluation_month": evaluation_month,
            "total_purchase_orders__supplies": total_deliveries,
            "on_time_delivery_score": on_time_delivery_score,
            "quality_score": quality_score,
            "rejection__non__conformance_cases": rejected_deliveries,
            "ppm_score": ppm_score,
            "capa_cases_count": capa_cases_count,
            "overall_supplier_rating": overall_supplier_rating,
            "performance_grade": performance_grade
        })

        doc.insert(ignore_permissions=True)

    frappe.db.commit()


def get_rating(overall_pct):
    if overall_pct >= 90:
        return "A"
    elif overall_pct >= 51:
        return "B"
    elif overall_pct >= 1:
        return "C"
    return ""