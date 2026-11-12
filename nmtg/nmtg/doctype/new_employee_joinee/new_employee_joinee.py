# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model import no_value_fields
from frappe.model.document import Document
from frappe.utils import add_days, getdate


class NewEmployeeJoinee(Document):
	pass


SKIP_FIELDS = {
	"name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
	"naming_series", "employee", "amended_from", "workflow_state", "status",
	"employee_onboarding", "observation_end_date", "doctype",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def copy_matching_fields(source, target, extra_skip=None):
	"""Copy every value field with the same fieldname from source to target."""
	skip = SKIP_FIELDS | set(extra_skip or [])
	target_fields = {
		df.fieldname for df in target.meta.fields
		if df.fieldtype not in no_value_fields
		and df.fieldtype not in ("Table", "Table MultiSelect")
	}
	for key, value in source.as_dict().items():
		if key in target_fields and key not in skip and value not in (None, "", []):
			target.set(key, value)


def copy_attachments(from_doctype, from_name, to_doctype, to_name):
	"""Copy sidebar attachments (File records) from one document to another."""
	files = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": from_doctype,
			"attached_to_name": from_name,
			"attached_to_field": ["is", "not set"],  # sidebar attachments only
		},
		fields=["file_name", "file_url", "is_private"],
	)
	for f in files:
		if frappe.db.exists("File", {
			"attached_to_doctype": to_doctype,
			"attached_to_name": to_name,
			"file_url": f.file_url,
		}):
			continue  # already attached, avoid duplicates
		frappe.get_doc({
			"doctype": "File",
			"file_name": f.file_name,
			"file_url": f.file_url,
			"is_private": f.is_private,
			"attached_to_doctype": to_doctype,
			"attached_to_name": to_name,
		}).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# 1. Employee Onboarding (on_submit) -> New Employee Joinee
# ---------------------------------------------------------------------------

def create_new_employee_joinee(doc, method=None):
	"""Runs when an Employee Onboarding is submitted."""

	if frappe.db.exists("New Employee Joinee", {"employee_onboarding": doc.name}):
		return

	joinee = frappe.new_doc("New Employee Joinee")
	joinee.employee_onboarding = doc.name

	# Job Applicant
	if doc.get("job_applicant"):
		applicant = frappe.get_doc("Job Applicant", doc.job_applicant)
		copy_matching_fields(applicant, joinee)
		first, _sep, last = (applicant.applicant_name or "").partition(" ")
		joinee.first_name = first
		joinee.last_name = last
		joinee.personal_email = applicant.get("email_id")
		joinee.cell_number = applicant.get("phone_number")

	# Existing Employee linked to the onboarding
	if doc.get("employee"):
		emp = frappe.get_doc("Employee", doc.employee)
		copy_matching_fields(emp, joinee)

	# Onboarding itself
	copy_matching_fields(doc, joinee)

	# Fields with different names
	if doc.get("employee_grade"):
		joinee.grade = doc.employee_grade
	if doc.get("employee_name"):
		joinee.employee_name = doc.employee_name
		if not joinee.get("first_name"):
			first, _sep, last = doc.employee_name.partition(" ")
			joinee.first_name = first
			joinee.last_name = last

	joinee.observation_end_date = add_days(getdate(doc.date_of_joining), 14)

	if joinee.meta.has_field("workflow_state"):
		joinee.workflow_state = "Under Observation"

	joinee.flags.ignore_mandatory = True
	joinee.insert(ignore_permissions=True)

	# Attachments (sidebar), copied after insert because the joinee needs a name
	copy_attachments("Employee Onboarding", doc.name, "New Employee Joinee", joinee.name)
	if doc.get("job_applicant"):
		copy_attachments("Job Applicant", doc.job_applicant, "New Employee Joinee", joinee.name)
	if doc.get("employee"):
		copy_attachments("Employee", doc.employee, "New Employee Joinee", joinee.name)

	frappe.msgprint(
		_("New Employee Joinee {0} created").format(
			frappe.get_desk_link("New Employee Joinee", joinee.name)),
		alert=True,
	)


# ---------------------------------------------------------------------------
# 2. New Employee Joinee -> Employee (Create Employee button)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def make_employee(source_name, target_doc=None):
	from frappe.model.mapper import get_mapped_doc

	def post_process(source, target):
		target.new_employee_joinee = source.name

	mapping = {
		"New Employee Joinee": {
			"doctype": "Employee",
			"field_no_map": [
				"naming_series", "employee", "employee_onboarding",
				"observation_end_date", "workflow_state", "status",
			],
		}
	}

	# Child tables present in both doctypes with the same child doctype
	emp_meta = frappe.get_meta("Employee")
	for df in frappe.get_meta("New Employee Joinee").get_table_fields():
		emp_df = emp_meta.get_field(df.fieldname)
		if emp_df and emp_df.options == df.options:
			mapping[df.options] = {"doctype": df.options}

	return get_mapped_doc("New Employee Joinee", source_name, mapping, target_doc, post_process)


# ---------------------------------------------------------------------------
# 3. Employee after_insert -> link back + copy attachments
# ---------------------------------------------------------------------------

def link_back_to_joinee(doc, method=None):
	if not doc.get("new_employee_joinee"):
		frappe.log_error(
			f"Employee {doc.name} has no new_employee_joinee value",
			"Joinee link missing",
		)
		return

	try:
		values = {"employee": doc.name}
		if frappe.get_meta("New Employee Joinee").has_field("workflow_state"):
			values["workflow_state"] = "Employee Created"
		frappe.db.set_value("New Employee Joinee", doc.new_employee_joinee, values)

		copy_attachments("New Employee Joinee", doc.new_employee_joinee, "Employee", doc.name)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Joinee to Employee attachment copy failed")