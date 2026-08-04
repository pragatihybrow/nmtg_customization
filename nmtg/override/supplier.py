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

	audit_content = frappe.render_template(
		"""
Your Supplier Audit Form is ready. Please complete it here:<br>
<a href="{{ base_url }}/supplier-audit-form?supplier_name={{ doc.supplier_name }}">Complete Supplier Audit Form</a><br><br>""",
		{"doc": doc, "base_url": get_url()},
	)

	registration_content = frappe.render_template(
		"""Dear {{ doc.supplier_name }},<br><br>
Your Supplier Registration Form is ready. Please complete it using the link below:<br><br>
<a href="{{ base_url }}/supplier-registration--form?supplier_name={{ doc.supplier_name | urlencode }}">Complete Supplier Registration Form</a><br><br>""",
		{"doc": doc, "base_url": get_url()},
	)

	message = f"""
	{registration_content}
	{audit_content}
	Thank you,<br>
	NMTG India<br>
	"""

	frappe.sendmail(
		recipients=[doc.email_id],
		subject=f"Supplier Forms - {doc.supplier_name}",
		message=message,
	)

	frappe.msgprint(f"Email sent to {doc.email_id}")