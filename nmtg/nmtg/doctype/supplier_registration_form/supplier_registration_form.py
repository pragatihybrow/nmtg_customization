# Copyright (c) 2026, Hybrowlabs and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document


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
                gstin=self.get("gst_no"),
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
        gstin=None,
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
        if gstin:
            address_doc.gstin = gstin
            # Registered Regular is the sensible default whenever a GSTIN is present;
            # adjust here if you need to derive a different GST category.
            if not address_doc.get("gst_category") or address_doc.gst_category == "Unregistered":
                address_doc.gst_category = "Registered Regular"
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
            if not any(row.email_id == email_id for row in contact_doc.email_ids):
                contact_doc.append("email_ids", {"email_id": email_id, "is_primary": 1})

        if phone:
            if not any(row.phone == phone for row in contact_doc.phone_nos):
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

        
# # Copyright (c) 2026, Hybrowlabs and contributors
# # For license information, please see license.txt
# import frappe
# from frappe.model.document import Document


# class SupplierRegistrationForm(Document):
#     def on_submit(self):
#         self.sync_to_supplier()

#     def sync_to_supplier(self):
#         if not self.supplier_name:
#             return

#         supplier = frappe.get_doc("Supplier", self.supplier_name)

#         field_map = {
#             "types_of_organization": "supplier_type",
#             "supplier_type": "custom_supplier_scope",
#             "request_type": "request_type",
#             "website": "website",
#             "country": "country",
#             "other_business": "custom_other_business",
#             "ownership": "custom_ownership",

#             # Tax / statutory
#             "gst_no": "gstin",
#             "pan_no": "pan",
#             "vat__tin_no": "custom_vat__tin_no",
#             "area_code": "custom_area_code",
#             "msme_no": "custom_msme_registration_no",
#             "central_excise_registration_no": "custom_central_excise_registration_no",
#             "cst_no": "custom_cst_no",
#             "website":"website",

#             # International / import
#             "taxpayer_identification_no__vat_id__ein": "custom_taxpayer_identification_no__vat_id__ein",
#             "import_export_code__export_license_no": "custom_import_export_code__export_license_no",
#             "nearest_seaport": "custom_nearest_seaport",
#             "nearest_airport": "custom_nearest_airport",
#             "transport__mode": "custom_preferble_transport__mode",
#             "other_transportation_mode": "custom_other_transportation_mode_",
#         }

#         for src_field, target_field in field_map.items():
#             value = self.get(src_field)
#             if value:
#                 supplier.set(target_field, value)

#         self.set_supplier_group(supplier)

#         supplier.custom_supplier_registration_form_created = 1
#         supplier.flags.ignore_mandatory = True
#         supplier.save(ignore_permissions=True)

#     def set_supplier_group(self, supplier):

#         checkbox_group_map = {
#             "service_provider__subcontractor": "Service Provider / Subcontractor",
#             "dealerdistributor": "Dealer/Distributor",
#             "trader": "Trader",
#             "manufacture": "Manufacture",
#         }

#         selected_groups = []
#         for fieldname, group_name in checkbox_group_map.items():
#             if self.get(fieldname):
#                 selected_groups.append(group_name)

#         # "Other / Multiple Business activity" -> comma-separated custom names
#         if self.get("other_mul") and self.get("other_business"):
#             for name in self.other_business.split(","):
#                 name = name.strip()
#                 if name:
#                     selected_groups.append(name)

#         if not selected_groups:
#             return

#         # Dedupe, preserving order
#         seen = set()
#         deduped = []
#         for g in selected_groups:
#             if g not in seen:
#                 seen.add(g)
#                 deduped.append(g)
#         selected_groups = deduped

#         # Rebuild fresh each submit (avoids stale/duplicate rows on re-submission flows)
#         supplier.set("custom_other_supplier_group_included", [])
#         for group_name in selected_groups:
#             supplier.append(
#                 "custom_other_supplier_group_included",
#                 {"supplier_group": self.get_or_create_supplier_group(group_name)},
#             )

#     @staticmethod
#     def get_or_create_supplier_group(group_name):
#         if frappe.db.exists("Supplier Group", group_name):
#             return group_name

#         parent = "All Supplier Groups"
#         if not frappe.db.exists("Supplier Group", parent):
#             parent = frappe.db.get_value("Supplier Group", {"is_group": 1}, "name")

#         group_doc = frappe.get_doc({
#             "doctype": "Supplier Group",
#             "supplier_group_name": group_name,
#             "parent_supplier_group": parent,
#             "is_group": 0,
#         })
#         group_doc.insert(ignore_permissions=True)
#         return group_doc.name