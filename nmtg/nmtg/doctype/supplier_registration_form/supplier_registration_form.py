# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document
from frappe.utils import getdate, nowdate, date_diff, add_days



class SupplierRegistrationForm(Document):
    def on_submit(self):
        self.sync_to_supplier()

    def sync_to_supplier(self):
        if not self.supplier_name:
            return

        supplier = frappe.get_doc("Supplier", self.supplier_name)

        field_map = {
            "types_of_organization": "supplier_type",
            "supplier_type": "custom_supplier_scope",
            "request_type": "request_type",
            "website": "website",
            "country": "country",
            "other_business": "custom_other_business",
            "ownership": "custom_ownership",

            # Tax / statutory
            "gst_no": "gstin",
            "pan_no": "pan",
            "vat__tin_no": "custom_vat__tin_no",
            "area_code": "custom_area_code",
            "msme_no": "custom_msme_registration_no",
            "central_excise_registration_no": "custom_central_excise_registration_no",
            "cst_no": "custom_cst_no",

            # International / import
            "taxpayer_identification_no__vat_id__ein": "custom_taxpayer_identification_no__vat_id__ein",
            "import_export_code__export_license_no": "custom_import_export_code__export_license_no",
            "nearest_seaport": "custom_nearest_seaport",
            "nearest_airport": "custom_nearest_airport",
            "transport__mode": "custom_preferble_transport__mode",
            "other_transportation_mode": "custom_other_transportation_mode_",
        }

        for src_field, target_field in field_map.items():
            value = self.get(src_field)
            if value:
                supplier.set(target_field, value)

        self.set_supplier_group(supplier)
        self.create_address_and_contact(supplier)

        supplier.custom_supplier_registration_form_created = 1
        supplier.flags.ignore_mandatory = True
        supplier.save(ignore_permissions=True)

    def set_supplier_group(self, supplier):

        checkbox_group_map = {
            "service_provider__subcontractor": "Service Provider / Subcontractor",
            "dealerdistributor": "Dealer/Distributor",
            "trader": "Trader",
            "manufacture": "Manufacture",
        }

        selected_groups = []
        for fieldname, group_name in checkbox_group_map.items():
            if self.get(fieldname):
                selected_groups.append(group_name)

        # "Other / Multiple Business activity" -> comma-separated custom names
        if self.get("other_mul") and self.get("other_business"):
            for name in self.other_business.split(","):
                name = name.strip()
                if name:
                    selected_groups.append(name)

        if not selected_groups:
            return

        # Dedupe, preserving order
        seen = set()
        deduped = []
        for g in selected_groups:
            if g not in seen:
                seen.add(g)
                deduped.append(g)
        selected_groups = deduped

        # Rebuild fresh each submit (avoids stale/duplicate rows on re-submission flows)
        supplier.set("custom_other_supplier_group_included", [])
        for group_name in selected_groups:
            supplier.append(
                "custom_other_supplier_group_included",
                {"supplier_group": self.get_or_create_supplier_group(group_name)},
            )

    def create_address_and_contact(self, supplier):
        """Create/update Office (and Factory) Address, and primary Contact, linked to the Supplier."""

        # ---------------- Office Address (Billing) ----------------
        if self.get("detailed_office_address") and self.get("city"):
            office_address_name = self.upsert_address(
                supplier_name=supplier.name,
                title_suffix="Office",
                address_type="Billing",
                address_line1=self.get("detailed_office_address"),
                city=self.get("city"),
                state=self.get("state__province"),
                country=self.get("country"),
                pincode=self.get("postal__zip_code"),
                phone=self.get("telephone"),
                email_id=self.get("email_id"),
                is_primary_address=1,
                is_shipping_address=1,
            )
            supplier.supplier_primary_address = office_address_name

        # ---------------- Factory Address (Plant), only if marked different ----------------
        if self.get("office_and_factory_address_are_different") and self.get("detailed_factory_address") and self.get("city_factory"):
            self.upsert_address(
                supplier_name=supplier.name,
                title_suffix="Factory",
                address_type="Plant",
                address_line1=self.get("detailed_factory_address"),
                city=self.get("city_factory"),
                state=self.get("state__province_factory"),
                country=self.get("country_factory"),
                pincode=self.get("postal__zip_code_factory"),
                phone=self.get("telephone"),
                is_primary_address=0,
                is_shipping_address=0,
            )

        # ---------------- Primary Contact ----------------
        if self.get("primary_contact_person") or self.get("email_id"):
            contact_name = self.upsert_contact(
                supplier_name=supplier.name,
                full_name=(self.get("primary_contact_person") or "").strip(),
                email_id=self.get("email_id"),
                phone=self.get("telephone"),
            )
            supplier.supplier_primary_contact = contact_name

    def upsert_address(
        self,
        supplier_name,
        title_suffix,
        address_type,
        address_line1,
        city,
        state,
        country,
        pincode,
        phone=None,
        email_id=None,
        is_primary_address=0,
        is_shipping_address=0,
    ):
        """Create or update an Address linked to the given Supplier."""

        existing = frappe.get_all(
            "Dynamic Link",
            filters={
                "link_doctype": "Supplier",
                "link_name": supplier_name,
                "parenttype": "Address",
            },
            fields=["parent"],
        )

        address_doc = None
        target_title = f"{supplier_name}-{title_suffix}"
        for row in existing:
            addr = frappe.get_doc("Address", row.parent)
            if addr.address_title == target_title:
                address_doc = addr
                break

        if not address_doc:
            address_doc = frappe.new_doc("Address")
            address_doc.address_title = target_title
            address_doc.address_type = address_type
            address_doc.append(
                "links", {"link_doctype": "Supplier", "link_name": supplier_name}
            )

        address_doc.address_line1 = address_line1
        address_doc.city = city
        if state:
            address_doc.state = state
        if country:
            address_doc.country = country
        if pincode:
            address_doc.pincode = pincode
        if phone:
            address_doc.phone = phone
        if email_id:
            address_doc.email_id = email_id
        address_doc.is_primary_address = is_primary_address
        address_doc.is_shipping_address = is_shipping_address

        address_doc.flags.ignore_mandatory = True
        if address_doc.is_new():
            address_doc.insert(ignore_permissions=True)
        else:
            address_doc.save(ignore_permissions=True)

        return address_doc.name

    def upsert_contact(self, supplier_name, full_name, email_id=None, phone=None):
        """Create or update the primary Contact linked to the given Supplier."""

        existing = frappe.get_all(
            "Dynamic Link",
            filters={
                "link_doctype": "Supplier",
                "link_name": supplier_name,
                "parenttype": "Contact",
            },
            fields=["parent"],
        )

        contact_doc = None
        for row in existing:
            c = frappe.get_doc("Contact", row.parent)
            if c.is_primary_contact:
                contact_doc = c
                break

        if not contact_doc:
            contact_doc = frappe.new_doc("Contact")
            contact_doc.append(
                "links", {"link_doctype": "Supplier", "link_name": supplier_name}
            )
            contact_doc.is_primary_contact = 1

        name_parts = full_name.split(" ", 1) if full_name else [supplier_name]
        contact_doc.first_name = name_parts[0] or supplier_name
        contact_doc.last_name = name_parts[1] if len(name_parts) > 1 else ""

        if email_id:
            existing_row = next((row for row in contact_doc.email_ids if row.email_id == email_id), None)
            if existing_row:
                # Make sure it's the one and only primary email
                for row in contact_doc.email_ids:
                    row.is_primary = 1 if row.email_id == email_id else 0
            else:
                # Unset any existing primary before adding the new primary email
                for row in contact_doc.email_ids:
                    row.is_primary = 0
                contact_doc.append("email_ids", {"email_id": email_id, "is_primary": 1})

        if phone:
            existing_row = next((row for row in contact_doc.phone_nos if row.phone == phone), None)
            if existing_row:
                for row in contact_doc.phone_nos:
                    row.is_primary_phone = 1 if row.phone == phone else 0
            else:
                for row in contact_doc.phone_nos:
                    row.is_primary_phone = 0
                contact_doc.append("phone_nos", {"phone": phone, "is_primary_phone": 1})

        contact_doc.flags.ignore_mandatory = True
        if contact_doc.is_new():
            contact_doc.insert(ignore_permissions=True)
        else:
            contact_doc.save(ignore_permissions=True)

        return contact_doc.name

    @staticmethod
    def get_or_create_supplier_group(group_name):
        if frappe.db.exists("Supplier Group", group_name):
            return group_name

        parent = "All Supplier Groups"
        if not frappe.db.exists("Supplier Group", parent):
            parent = frappe.db.get_value("Supplier Group", {"is_group": 1}, "name")

        group_doc = frappe.get_doc({
            "doctype": "Supplier Group",
            "supplier_group_name": group_name,
            "parent_supplier_group": parent,
            "is_group": 0,
        })
        group_doc.insert(ignore_permissions=True)
        return group_doc.name



# Certificate definitions: (label, checkbox_field, expiry_field)
CERTIFICATE_FIELDS = [
	("IATF 16949", "iatf_16949", "date_of_expiry_iatf_16949"),
	("ISO 9001", "iso_9001", "date_of_expiry_iso_9001"),
	("ISO 14001", "iso_14001", "date_of_expiry_iso_14001"),
	("ISO 45001", "iso_45001", "date_of_expiry_iso_45001"),
	("ISO 50001", "iso_50001", "date_of_expiry_iso_50001"),
	("Other Standard", "other_standard", "date_of_expiry"),
]

REMINDER_DAYS_BEFORE = 7


def send_certificate_expiry_reminders():
	"""
	Daily scheduled job.
	Finds Supplier Registration Form records where any certificate expires
	exactly REMINDER_DAYS_BEFORE days from today, and emails the supplier
	a single reminder listing all such certificates.

	Add to hooks.py:
		scheduler_events = {
			"daily": [
				"hybrowlabs.hybrowlabs.doctype.supplier_registration_form.supplier_registration_form.send_certificate_expiry_reminders"
			]
		}
	"""
	target_date = add_days(nowdate(), REMINDER_DAYS_BEFORE)

	# Build a single query condition covering all expiry fields so we only
	# fetch records that actually need attention today.
	or_conditions = " or ".join(
		[f"(`{checkbox}` = 1 and `{expiry_field}` = %(target_date)s)" for _, checkbox, expiry_field in CERTIFICATE_FIELDS]
	)

	records = frappe.db.sql(
		f"""
		select name, email_id
		from `tabSupplier Registration Form`
		where email_id is not null and email_id != '' and ({or_conditions})
		""",
		{"target_date": target_date},
		as_dict=True,
	)

	for record in records:
		doc = frappe.get_doc("Supplier Registration Form", record.name)
		expiring = _get_expiring_certificates(doc, target_date)

		if not expiring:
			continue

		_send_reminder_email(doc, expiring)


def _get_expiring_certificates(doc, target_date):
	"""Return list of (label, expiry_date) for certificates expiring on target_date."""
	expiring = []
	for label, checkbox_field, expiry_field in CERTIFICATE_FIELDS:
		if doc.get(checkbox_field) and doc.get(expiry_field):
			if getdate(doc.get(expiry_field)) == getdate(target_date):
				expiring.append((label, doc.get(expiry_field)))
	return expiring


def _send_reminder_email(doc, expiring):
    supplier_name = doc.get("supplier_name") or doc.name

    cert_lines = "".join(
        f"<li>{label} — expires on {frappe.utils.formatdate(expiry_date)}</li>"
        for label, expiry_date in expiring
    )

    message = f"""
        <p>Dear <strong>{supplier_name}</strong>,</p>

        <p>Greetings from NMTG!</p>

        <p>
            This is a reminder that the following certificate(s) submitted as part of your
            <strong>Supplier Registration</strong> are due to expire within the next
            <strong>{REMINDER_DAYS_BEFORE} days</strong>:
        </p>

        <p><strong>Certificate Details:</strong></p>

        <ul>
            {cert_lines}
        </ul>

        <p>
            Kindly arrange to renew the applicable certificate(s) and upload/share the
            updated copies at the earliest to ensure that your supplier documentation
            remains valid and up to date.
        </p>

        <p>
            If the certificate has already been renewed, please disregard this reminder
            and share the latest copy with us for record updation.
        </p>

        <p>
            Thank you for your prompt attention and continued cooperation.
        </p>

        <p>
            <strong>Best Regards,</strong><br>
            <strong>NMTG Quality Team</strong><br>
            NMTG Mechtrans Techniques Pvt. Ltd.<br>
            <a href="http://www.nmtgindia.com">www.nmtgindia.com</a>
        </p>
    """

    frappe.sendmail(
        recipients=[doc.email_id],
        subject="Reminder: Supplier Certificate Expiring Soon",
        message=message,
        reference_doctype=doc.doctype,
        reference_name=doc.name,
    )

    frappe.logger().info(
        f"Sent certificate expiry reminder for {doc.name} to {doc.email_id}"
    )

