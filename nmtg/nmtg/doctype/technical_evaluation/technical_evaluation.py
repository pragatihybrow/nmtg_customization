# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
import json
from frappe.utils.file_manager import get_file
from frappe.model.document import Document


class TechnicalEvaluation(Document):

    def before_insert(self):
        self.set_version()

    def before_save(self):
        self.generate_request_numbers()

    def on_update(self):
        self.update_opportunity_status()

    def on_submit(self):
        self.sync_items_to_opportunity()
        self.update_opportunity_status()

    def on_cancel(self):
        self.update_opportunity_status()

    def set_version(self):
        if not self.opportunity_no:
            self.version = "V1"
            return

        existing_count = frappe.db.count(
            "Technical Evaluation",
            filters={
                "opportunity_no": self.opportunity_no,
                "docstatus": ["!=", 2],
            },
        )

        self.version = f"V{existing_count + 1}"

    def generate_request_numbers(self):
        for idx, row in enumerate(self.items, start=1):
            row.request_no = f"R-{idx:03d}"

    def update_opportunity_status(self):
        if not self.opportunity_no:
            return

        evaluations = frappe.get_all(
            "Technical Evaluation",
            filters={
                "opportunity_no": self.opportunity_no,
                "docstatus": ["!=", 2],
            },
            fields=[
                "name",
                "version",
                "docstatus",
            ],
        )

        if not evaluations:
            return

        # Get latest version
        latest_evaluation = max(
            evaluations,
            key=lambda d: self.get_version_number(d.version) or 0
        )

        latest_version = self.get_version_number(
            latest_evaluation.version
        )

        if latest_version is None:
            return

        # Latest TE is Draft
        if latest_evaluation.docstatus == 0:
            status = "Technical Evaluation Under Review"

        # Latest TE is Submitted
        elif latest_evaluation.docstatus == 1:
            status = "Technical Evaluation Cleared"

        else:
            return

        # Get current Opportunity status
        current_status = frappe.db.get_value(
            "Opportunity",
            self.opportunity_no,
            "status"
        )

        # Update only if status has changed
        if current_status != status:
            frappe.db.set_value(
                "Opportunity",
                self.opportunity_no,
                "status",
                status,
                update_modified=True,
            )

    def sync_items_to_opportunity(self):
        if not self.opportunity_no:
            return

        opportunity = frappe.get_doc(
            "Opportunity",
            self.opportunity_no
        )

        new_version_no = self.get_version_number(
            self.version
        )

        # Group existing opportunity items by item_code
        opp_items_by_code = {}

        for opp_item in opportunity.items:
            if opp_item.item_code:
                opp_items_by_code.setdefault(
                    opp_item.item_code,
                    []
                ).append(opp_item)

        updated = False

        for idx, te_item in enumerate(self.items):
            opp_item = None
            is_new_row = False

            # 1. Match by item_code
            if (
                te_item.item_code
                and opp_items_by_code.get(te_item.item_code)
            ):
                opp_item = opp_items_by_code[
                    te_item.item_code
                ].pop(0)

            # 2. Fallback to row position
            elif (
                not te_item.item_code
                and idx < len(opportunity.items)
            ):
                opp_item = opportunity.items[idx]

            # 3. Create new row
            else:
                opp_item = opportunity.append(
                    "items",
                    {}
                )

                opp_item.item_code = te_item.item_code
                opp_item.qty = te_item.qty or 1
                opp_item.rate = 0
                opp_item.amount = 0
                opp_item.base_rate = 0
                opp_item.base_amount = 0

                is_new_row = True

            # Don't overwrite a newer TE version
            if not is_new_row:

                existing_version_no = self.get_version_number(
                    opp_item.custom_version
                )

                if (
                    existing_version_no is not None
                    and existing_version_no > new_version_no
                ):
                    continue

            opp_item.custom_request_no = te_item.request_no
            opp_item.custom_product_group = te_item.product_group

            opp_item.custom_customer_requirement_brief_description = (
                te_item.customer_requirement__brief
            )

            opp_item.custom_selected_model = (
                te_item.nmtg_model
            )

            opp_item.custom_technical_evaluation = self.name

            opp_item.custom_technical_status = (
                te_item.technical_status
            )

            opp_item.custom_selection_type = (
                te_item.selection_type
            )

            opp_item.custom_remarks = (
                te_item.remark
            )

            opp_item.custom_version = self.version

            updated = True

        if updated:
            opportunity.flags.ignore_permissions = True
            opportunity.flags.ignore_validate_update_after_submit = True
            opportunity.save()

    @staticmethod
    def get_version_number(version_str):

        if not version_str:
            return None

        try:
            return int(
                str(version_str).lstrip("Vv")
            )

        except (ValueError, TypeError):
            return None



EMAIL_SUBJECT_TEMPLATE = "Drawing / Technical Document Verification Required – {opportunity_no}"

EMAIL_BODY_TEMPLATE = """
<p>Dear {{ doc.customer }},</p>

<p>Greetings from NMTG Mechtrans Techniques Pvt. Ltd.</p>

<p>
    With reference to your enquiry and the technically selected product, please find
    the relevant drawing / technical document submitted for your review and
    verification.
</p>

<p><b>Selected Product Details:</b></p>

<table border="1"
       cellpadding="6"
       cellspacing="0"
       style="
           border-collapse:collapse;
           width:100%;
           font-family:Arial, sans-serif;
           font-size:13px;
       ">
    <thead style="background-color:#f2f2f2;">
        <tr>
            <th>Product</th>
            <th>NMTG Model</th>
            <th>Size</th>
            <th>Customer Material Code</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        {% for item in items %}
        <tr>
            <td>{{ item.product_group or "" }}</td>
            <td>{{ item.nmtg_model or "" }}</td>
            <td>{{ get_formatted_size(item.required_feilds) }}</td>
            <td>{{ item.customer_material_code or item.item_code or "" }}</td>
            <td>{{ item.remark or item.item_name or "" }}</td>
        </tr>
        {% endfor %}
    </tbody>
</table>

<p>
    Kindly review the submitted drawing / technical document with respect to your
    application and confirm your approval / acceptance so that we can proceed with
    the next stage.
</p>

<p>
    In case any modification or clarification is required, please share your
    comments with us for further review.
</p>

<p>Thank you for your cooperation.</p>

<p>
    <b>Best Regards,</b><br>
    <b>NMTG Sales Team</b><br>
    NMTG Mechtrans Techniques Pvt. Ltd.<br>
    <a href="https://www.nmtgindia.com">www.nmtgindia.com</a>
</p>
"""


def _get_formatted_size(required_feilds_json):
	"""required_feilds is stored as a JSON string, e.g. {"custom_id":50,"custom_od":40,"custom_tl":20}"""
	if not required_feilds_json:
		return ""

	try:
		dims = json.loads(required_feilds_json)
	except (TypeError, ValueError):
		return ""

	label_map = {
		"custom_id": "ID",
		"custom_od": "OD",
		"custom_tl": "TL",
	}

	parts = []
	for fieldname, label in label_map.items():
		if fieldname in dims and dims.get(fieldname) not in (None, ""):
			parts.append(f"{label} {dims.get(fieldname)} mm")

	return " x ".join(parts)


def _get_recipients(doc):
	recipients = []

	if doc.custom_primary_contact_email:
		recipients.append(doc.custom_primary_contact_email)

	if doc.custom_other_contact_emails:
		others = [e.strip() for e in doc.custom_other_contact_emails.split(",") if e.strip()]
		recipients.extend(others)

	seen = set()
	deduped = []
	for r in recipients:
		if r.lower() not in seen:
			seen.add(r.lower())
			deduped.append(r)

	return deduped


def _get_attachments_for_request_nos(doc, request_nos):
	"""Return list of (fname, fcontent) dicts for attachment rows matching any of request_nos."""
	attachments = []

	for att in doc.get("attachment", []):
		if att.request_no not in request_nos or not att.attachment:
			continue

		try:
			filename, filecontent = get_file(att.attachment)
			attachments.append({"fname": filename, "fcontent": filecontent})
		except Exception:
			frappe.log_error(
				title="Drawing Verification Email - Attachment Fetch Failed",
				message=frappe.get_traceback(),
			)

	return attachments


@frappe.whitelist()
def send_drawing_verification_emails_for_doc(docname):
	doc = frappe.get_doc("Technical Evaluation", docname)

	recipients = _get_recipients(doc)

	pending_items = [
		item for item in doc.items
		if item.drawing_approval_required == "Yes" and not item.get("drawing_email_sent")
	]

	sent = []
	skipped = []

	if not pending_items:
		return {"sent": sent, "skipped": ["No pending items found"]}

	if not recipients:
		return {"sent": sent, "skipped": ["No recipient email configured on the document"]}

	# split pending items into those with attachments vs without, so a single
	# missing attachment doesn't block the rest of the document
	request_nos = [item.request_no for item in pending_items]
	available_attachments = {att.request_no for att in doc.get("attachment", []) if att.attachment}

	items_to_email = []
	for item in pending_items:
		if item.request_no in available_attachments:
			items_to_email.append(item)
		else:
			skipped.append(f"{item.request_no}: no attachment found")

	if not items_to_email:
		return {"sent": sent, "skipped": skipped}

	body = frappe.render_template(
		EMAIL_BODY_TEMPLATE,
		{
			"doc": doc,
			"items": items_to_email,
			"get_formatted_size": _get_formatted_size,
		},
	)

	subject = EMAIL_SUBJECT_TEMPLATE.format(opportunity_no=doc.opportunity_no or doc.name)

	attachments = _get_attachments_for_request_nos(
		doc, {item.request_no for item in items_to_email}
	)

	try:
		frappe.sendmail(
			recipients=recipients,
			subject=subject,
			message=body,
			attachments=attachments,
			reference_doctype=doc.doctype,
			reference_name=doc.name,
		)
	except Exception as e:
		frappe.log_error(
			title="Drawing Verification Email - Send Failed",
			message=frappe.get_traceback(),
		)
		skipped.extend(f"{item.request_no}: email send failed - {str(e)}" for item in items_to_email)
		return {"sent": sent, "skipped": skipped}

	
	for item in items_to_email:
		sent.append(item.request_no)
		try:
			item.db_set("drawing_email_sent", 1, update_modified=False)
		except Exception as e:
			frappe.log_error(
				title="Drawing Verification Email - Tracking Update Failed",
				message=frappe.get_traceback(),
			)
			skipped.append(f"{item.request_no}: email sent, but failed to mark drawing_email_sent - {str(e)}")

	try:
		doc.db_set("attachment_email_sent", 1, update_modified=False)
	except Exception:
		frappe.log_error(
			title="Drawing Verification Email - Parent Flag Update Failed",
			message=frappe.get_traceback(),
		)

	return {"sent": sent, "skipped": skipped}