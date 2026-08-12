import frappe
from frappe.utils import get_url



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

# @frappe.whitelist()
# def send_supplier_forms(supplier):
# 	doc = frappe.get_doc("Supplier", supplier)

# 	if not doc.email_id:
# 		frappe.throw("Supplier does not have an Email ID set (via Primary Contact).")

# 	category = doc.custom_supplier_category

# 	registration_content = frappe.render_template(
# 		"""Dear {{ doc.supplier_name }},<br><br>
# Your Supplier Registration Form is ready. Please complete it using the link below:<br><br>
# <a href="{{ base_url }}/supplier-registration-form?supplier_name={{ doc.supplier_name | urlencode }}">Complete Supplier Registration Form</a><br><br>""",
# 		{"doc": doc, "base_url": get_url()},
# 	)

# 	audit_content = ""
# 	if category == "A":
# 		audit_content = frappe.render_template(
# 			"""
# Your Supplier Audit Form is ready. Please complete it here:<br>
# <a href="{{ base_url }}/supplier-audit-form?supplier_name={{ doc.supplier_name | urlencode }}">Complete Supplier Audit Form</a><br><br>""",
# 			{"doc": doc, "base_url": get_url()},
# 		)

# 	message = f"""
# 	{registration_content}
# 	{audit_content}
# 	Thank you,<br>
# 	NMTG India<br>
# 	"""

# 	frappe.sendmail(
# 		recipients=[doc.email_id],
# 		subject=f"Supplier Forms - {doc.supplier_name}",
# 		message=message,
# 	)

# 	frappe.msgprint(f"Email sent to {doc.email_id}")



@frappe.whitelist()
def get_computed_supplier_status(supplier):
    doc = frappe.get_doc("Supplier", supplier)
    return get_supplier_status(doc.as_dict())