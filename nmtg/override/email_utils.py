import frappe
from frappe.utils import escape_html


def get_thread_mail_args(opportunity_no=None, fallback_customer=None, fallback_rfq=None):
    """
    Returns (subject, in_reply_to) so every mail threads with the
    first mail sent on the Opportunity.
    Subject format: NMTG | Customer Name | Opportunity | Customer RFQ Number
    """
    opportunity_no = (opportunity_no or "").strip()
    customer_name = ""
    customer_rfq_number = ""

    if opportunity_no:
        opp = frappe.db.get_value(
            "Opportunity",
            opportunity_no,
            ["customer_name", "custom_customer_rfq_number"],
            as_dict=True,
        )
        if opp:
            customer_name = (opp.customer_name or "").strip()
            customer_rfq_number = (opp.custom_customer_rfq_number or "").strip()

    customer_name = customer_name or (fallback_customer or "").strip()
    customer_rfq_number = customer_rfq_number or (fallback_rfq or "").strip()

    subject = " | ".join(
        p for p in ["NMTG", customer_name, opportunity_no, customer_rfq_number] if p
    )

    in_reply_to = None
    if opportunity_no:
        message_id = frappe.db.get_value(
            "Communication",
            {
                "reference_doctype": "Opportunity",
                "reference_name": opportunity_no,
                "communication_type": "Communication",
                "sent_or_received": "Sent",
            },
            "message_id",
            order_by="creation asc",
        )
        if message_id:
            message_id = message_id.strip()
            if not message_id.startswith("<"):
                message_id = f"<{message_id}>"
            in_reply_to = message_id

    return subject, in_reply_to


def build_table_html(columns, items, table_style=None):
    """
    columns: list of (header_label, getter) where getter(item) -> value
    items:   list of rows/objects
    Columns that are empty for EVERY item are removed (header + cells).
    Returns the HTML string, or "" if there is nothing to show.
    """
    matrix = [
        [str(getter(item) or "").strip() for _label, getter in columns]
        for item in items
    ]

    keep = [i for i in range(len(columns)) if any(row[i] for row in matrix)]
    if not keep:
        return ""

    style = table_style or (
        "border-collapse:collapse;width:100%;"
        "font-family:Arial, sans-serif;font-size:13px;"
    )

    th = "".join(f"<th>{escape_html(columns[i][0])}</th>" for i in keep)
    body = "".join(
        "<tr>" + "".join(f"<td>{escape_html(row[i])}</td>" for i in keep) + "</tr>"
        for row in matrix
    )

    return (
        f'<table border="1" cellpadding="6" cellspacing="0" style="{style}">'
        f'<thead style="background-color:#f2f2f2;"><tr>{th}</tr></thead>'
        f"<tbody>{body}</tbody></table>"
    )


def send_email(
    recipients,
    subject,
    message,
    cc=None,
    attachments=None,
    reference_doctype=None,
    reference_name=None,
    in_reply_to=None,
    log_title="Email Send Failed",
    raise_on_error=False,
):
    """
    Single entry point for sending mail. Sender is Frappe's default outgoing account.
    Returns (True, None) on success, (False, error_message) on failure.
    """
    if not recipients:
        return False, "No recipients"

    args = dict(
        recipients=recipients,
        subject=subject,
        message=message,
        reference_doctype=reference_doctype,
        reference_name=reference_name,
    )
    if cc:
        args["cc"] = cc
    if attachments:
        args["attachments"] = attachments
    if in_reply_to:
        args["in_reply_to"] = in_reply_to

    try:
        frappe.sendmail(**args)
        return True, None
    except Exception as e:
        frappe.log_error(title=log_title, message=frappe.get_traceback())
        if raise_on_error:
            raise
        return False, str(e)