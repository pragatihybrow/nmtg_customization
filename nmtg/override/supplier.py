import frappe
from frappe.utils import get_url
from frappe.utils import getdate, add_to_date, cint, today



def get_supplier_status(supplier):
	category = supplier.get("custom_supplier_category")
	reg_created = supplier.get("custom_supplier_registration_form_created")
	audit_created = supplier.get("custom_supplier_audit_form_created")

	if category == "C":
		return "Approved Supplier"
	if category == "B" and reg_created:
		return "Approved Supplier"
	if category == "A" and reg_created and audit_created:
		return "Approved Supplier"

	return "Unapproved Supplier"


def update_supplier_status(supplier_name):
	"""Call this after directly setting custom_supplier_registration_form_created
	or custom_supplier_audit_form_created via frappe.db.set_value (bypasses validate)."""
	supplier = frappe.db.get_value(
		"Supplier",
		supplier_name,
		[
			"custom_supplier_category",
			"custom_supplier_registration_form_created",
			"custom_supplier_audit_form_created",
			"custom_supplier_status",
		],
		as_dict=True,
	)
	if not supplier:
		return

	new_status = get_supplier_status(supplier)
	if new_status and new_status != supplier.custom_supplier_status:
		frappe.db.set_value("Supplier", supplier_name, "custom_supplier_status", new_status)


def validate(doc, method):
	"""Catches manual edits to Supplier (e.g. category changed to C in the form)."""
	set_next_audit_date_on_save(doc)
	new_status = get_supplier_status(doc.as_dict())
	if new_status:
		doc.custom_supplier_status = new_status


@frappe.whitelist()
def send_supplier_forms(supplier):
	doc = frappe.get_doc("Supplier", supplier)

	if not doc.email_id:
		frappe.throw("Supplier does not have an Email ID set (via Primary Contact).")

	category = doc.custom_supplier_category
	base_url = get_url()

	# Sender details - pulled from the logged-in user, adjust as needed
	user = frappe.get_doc("User", frappe.session.user)
	sender_name = user.full_name or frappe.session.user
	sender_designation = user.get("designation") or ""  # only exists if you have this field on User
	sender_contact = user.get("mobile_no") or user.get("phone") or ""

	registration_link = f"{base_url}/supplier-registration-form?supplier_name={frappe.utils.quote(doc.supplier_name)}"
	audit_link = f"{base_url}/supplier-audit-form?supplier_name={frappe.utils.quote(doc.supplier_name)}"

	context = {
		"supplier_name": doc.supplier_name,
		"registration_link": registration_link,
		"audit_link": audit_link,
		"show_audit": category == "A",
		"sender_name": sender_name,
		"sender_designation": sender_designation,
		"sender_contact": sender_contact,
	}

	message = frappe.render_template(
		"""
Hello Sir/Madam,<br><br>

Greetings from NMTG!<br><br>

As part of our supplier registration process, kindly complete the following form(s) using the link(s) below:<br><br>

Supplier Registration Form:<br>
<a href="{{ registration_link }}">{{ registration_link }}</a><br><br>

{% if show_audit %}
Supplier Audit Form:<br>
<a href="{{ audit_link }}">{{ audit_link }}</a><br><br>
{% endif %}

Kindly complete the form(s) at your earliest convenience to help us complete the supplier onboarding process.<br><br>

Thank you for your cooperation.<br><br>

Best Regards,<br>
{{ sender_name }}<br>
{% if sender_designation %}{{ sender_designation }}<br>{% endif %}
{% if sender_contact %}{{ sender_contact }}<br>{% endif %}
<a href="https://www.nmtgindia.com">www.nmtgindia.com</a>
""",
		context,
	)

	frappe.sendmail(
		recipients=[doc.email_id],
		subject=f"Action Required: Supplier Registration{' & Audit Forms' if category == 'A' else ' Form'} – NMTG",
		message=message,
	)

	frappe.msgprint(f"Email sent to {doc.email_id}")


def get_last_approved_audit_date(supplier_name):
	result = frappe.get_all(
		"Supplier Audit",
		filters={
			"supplier": supplier_name,
			"workflow_state": "Approved By Quality",
			"docstatus": 1,
		},
		fields=["date"],
		order_by="creation desc",
		limit=1,
	)
	return result[0].date if result else None


def get_audit_cycle_delta(doc):
	frequency = doc.custom_supplier_audit_frequency

	if frequency == "Years":
		years = cint(doc.custom_years or 0)
		return {"years": years} if years else None

	if frequency == "Months":
		months = cint(doc.custom_months or 0)
		return {"months": months} if months else None

	return None


def set_next_audit_date_on_save(doc):
	delta = get_audit_cycle_delta(doc)
	if not delta:
		return

	last_audit_date = get_last_approved_audit_date(doc.name)
	anchor_date = getdate(last_audit_date) if last_audit_date else getdate(today())

	old_doc = doc.get_doc_before_save()
	cycle_changed = (
		not old_doc
		or old_doc.custom_supplier_audit_frequency != doc.custom_supplier_audit_frequency
		or cint(old_doc.custom_years or 0) != cint(doc.custom_years or 0)
		or cint(old_doc.custom_months or 0) != cint(doc.custom_months or 0)
	)

	needs_recalc = (
		not doc.custom_next_audit_date
		or cycle_changed
		or (doc.get("custom_last_audit_anchor") and getdate(doc.custom_last_audit_anchor) != anchor_date)
	)

	if needs_recalc:
		doc.custom_next_audit_date = add_to_date(anchor_date, **delta)
		doc.custom_last_audit_anchor = anchor_date

@frappe.whitelist()
def get_computed_supplier_status(supplier):
    doc = frappe.get_doc("Supplier", supplier)
    return get_supplier_status(doc.as_dict())


def send_due_supplier_audit_reminders():
	suppliers = frappe.get_all(
		"Supplier",
		filters={
			"custom_next_audit_date": today(),
			"disabled": 0,
		},
		fields=["name", "supplier_name", "email_id", "custom_next_audit_date"],
	)

	for row in suppliers:
		try:
			send_audit_due_reminder(row)
		except Exception:
			frappe.log_error(
				title="Supplier Audit Reminder Failed",
				message=f"Supplier: {row.name}\n\n{frappe.get_traceback()}",
			)

def send_audit_due_reminder(supplier_row):
	if not supplier_row.email_id:
		frappe.log_error(
			title="Supplier Audit Reminder Skipped",
			message=f"Supplier {supplier_row.name} has no Email ID set; cannot send audit reminder.",
		)
		return

	base_url = get_url()
	audit_link = (
		f"{base_url}/supplier-audit-form?supplier_name={frappe.utils.quote(supplier_row.supplier_name)}"
	)

	context = {
		"supplier_name": supplier_row.supplier_name,
		"audit_link": audit_link,
		"due_date": frappe.utils.formatdate(supplier_row.custom_next_audit_date),
	}

	message = frappe.render_template(
		"""
Hello Sir/Madam,<br><br>

Greetings from NMTG!<br><br>

As part of our periodic Supplier Quality Audit process, your supplier re-audit is
now due as per the scheduled audit cycle.<br><br>

We request you to kindly complete the Supplier Audit Form using the link below at
your earliest convenience.<br><br>

Supplier Audit Form:<br>
<a href="{{ audit_link }}">{{ audit_link }}</a><br><br>

Re-Audit Due Date: {{ due_date }}<br><br>

Your timely response will help us complete the supplier re-evaluation process and
maintain our approved supplier records.<br><br>

Thank you for your continued support and cooperation.<br><br>

Best Regards,<br>
NMTG Quality Team<br>
NMTG Mechtrans Techniques Pvt. Ltd.<br>
<a href="https://www.nmtgindia.com">www.nmtgindia.com</a>
""",
		context,
	)

	frappe.sendmail(
		recipients=[supplier_row.email_id],
		subject="Supplier Re-Audit Due – Action Required",
		message=message,
	)


def update_supplier_next_audit_date(doc, method=None):
	if doc.workflow_state != "Approved By Quality":
		return

	supplier = frappe.get_doc("Supplier", doc.supplier)

	delta = get_audit_cycle_delta(supplier)
	if not delta:
		return

	from frappe.utils import add_to_date

	anchor_date = getdate(doc.date)
	next_audit_date = add_to_date(anchor_date, **delta)

	frappe.db.set_value(
		"Supplier",
		supplier.name,
		{
			"custom_next_audit_date": next_audit_date,
			# "custom_last_audit_anchor": anchor_date,
		},
		update_modified=False,
	)


@frappe.whitelist()
def trigger_supplier_audit_reminders_manually():
	send_due_supplier_audit_reminders()
	frappe.msgprint("Supplier audit reminder check completed.")