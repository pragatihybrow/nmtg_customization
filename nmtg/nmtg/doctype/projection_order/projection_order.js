// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

const PO_ITEM_FIELDS = [
	"item_name",
	"description",
	"item_group",
	"brand",
	"image",
	"stock_uom",
	"uom",
	"conversion_factor",
	"warehouse",
	"min_order_qty",
	"projected_qty",
	"actual_qty",
	"rate",
	"price_list_rate",
	"expense_account",
	"cost_center",
	"bom_no",
	"manufacturer",
	"manufacturer_part_no",
	"lead_time_date",
	"reorder_level",
	"reorder_qty",
	"projected_on_hand",
];

const PO_MR_HEADER_FIELDS = [
	"company",
	"material_request_type",
	"transaction_date",
	"schedule_date",
	"customer",
	"custom_priority",
	"customer_address",
	"address_display",
	"billing_address_gstin",
	"gst_category",
	"place_of_supply",
	"customer_group",
	"territory",
	"contact_person",
	"contact_display",
	"contact_phone",
	"contact_mobile",
	"contact_email",
	"shipping_address_name",
	"shipping_address",
	"dispatch_address_name",
	"dispatch_address",
	"company_address",
	"company_gstin",
	"company_address_display",
	"company_contact_person",
];

// Item row fields copied to the Material Request (only if the field exists there)
const PO_MR_ITEM_FIELDS = [
	"item_code",
	"item_name",
	"description",
	"item_group",
	"brand",
	"image",
	"qty",
	"uom",
	"stock_uom",
	"conversion_factor",
	"stock_qty",
	"warehouse",
	"schedule_date",
	"rate",
	"price_list_rate",
	"amount",
	"min_order_qty",
	"projected_qty",
	"actual_qty",
	"expense_account",
	"cost_center",
	"project",
	"bom_no",
	"manufacturer",
	"manufacturer_part_no",
	"lead_time_date",
	"reorder_level",
	"reorder_qty",
	"projected_on_hand",
	"gst_hsn_code",
	"custom_tds_attachment",
	"custom_quantity_in_mm",
];

function po_get_company(frm) {
	return frm.doc.company || frappe.defaults.get_user_default("Company");
}

function po_recalculate_row(cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty = flt(row.qty);
	const cf = flt(row.conversion_factor) || 1;
	frappe.model.set_value(cdt, cdn, "stock_qty", flt(qty * cf, 9));
	frappe.model.set_value(cdt, cdn, "amount", flt(qty * flt(row.rate)));
}

// True if a Material Request is already linked to any item row
function po_has_material_request(frm) {
	return (frm.doc.items || []).some((row) => row.custom_material_request);
}

// ---------- create Material Request from Projection Order ----------

function po_make_material_request(frm) {
	frappe.model.with_doctype("Material Request", () => {
		const mr = frappe.model.get_new_doc("Material Request");

		// header
		PO_MR_HEADER_FIELDS.forEach((field) => {
			if (frappe.meta.has_field("Material Request", field) && frm.doc[field]) {
				mr[field] = frm.doc[field];
			}
		});
		mr.material_request_type = frm.doc.material_request_type || "Manufacture";
		if (frappe.meta.has_field("Material Request", "set_warehouse") && frm.doc.warehouse) {
			mr.set_warehouse = frm.doc.warehouse;
		}

		// items: add the child row first, then set each field on it
		(frm.doc.items || []).forEach((src) => {
			const row = frappe.model.add_child(mr, "Material Request Item", "items");
			PO_MR_ITEM_FIELDS.forEach((field) => {
				if (
					frappe.meta.has_field("Material Request Item", field) &&
					src[field] !== undefined &&
					src[field] !== null &&
					src[field] !== ""
				) {
					row[field] = src[field];
				}
			});

			// link back to the source Projection Order and its item row.
			// The server hook (after_insert on Material Request) writes the MR
			// reference back to the Projection Order item rows.
			if (frappe.meta.has_field("Material Request Item", "custom_projection_order")) {
				row.custom_projection_order = frm.doc.name;
			}
			if (frappe.meta.has_field("Material Request Item", "custom_projection_order_item")) {
				row.custom_projection_order_item = src.name;
			}
		});

		frappe.set_route("Form", "Material Request", mr.name);
	});
}

// ---------- address / contact helpers ----------

function po_address_query(link_doctype, get_link_name) {
	return function (doc) {
		const link_name = get_link_name(doc);
		if (!link_name) return {};
		return {
			query: "frappe.contacts.doctype.address.address.address_query",
			filters: { link_doctype: link_doctype, link_name: link_name },
		};
	};
}

function po_contact_query(link_doctype, get_link_name) {
	return function (doc) {
		const link_name = get_link_name(doc);
		if (!link_name) return {};
		return {
			query: "frappe.contacts.doctype.contact.contact.contact_query",
			filters: { link_doctype: link_doctype, link_name: link_name },
		};
	};
}

// Warehouse filter: only non-group warehouses of the selected company
function po_warehouse_query(frm) {
	return function () {
		const company = po_get_company(frm);
		const filters = { is_group: 0 };
		if (company) filters.company = company;
		return { filters: filters };
	};
}

// Fill a display field from an Address link field
function po_set_address_display(frm, link_field, display_field) {
	const name = frm.doc[link_field];
	if (!name) {
		return frm.set_value(display_field, "");
	}
	return frappe
		.call({
			method: "frappe.contacts.doctype.address.address.get_address_display",
			args: { address_dict: name },
		})
		.then((r) => frm.set_value(display_field, r.message || ""));
}

function po_clear_contact(frm) {
	return Promise.all([
		frm.set_value("contact_display", ""),
		frm.set_value("contact_phone", ""),
		frm.set_value("contact_mobile", ""),
		frm.set_value("contact_email", ""),
	]);
}

function po_get_default_address(doctype, name) {
	return frappe
		.call({
			method: "frappe.contacts.doctype.address.address.get_default_address",
			args: { doctype: doctype, name: name },
		})
		.then((r) => r.message || "");
}

// First Contact linked to the given party (uses whitelisted frappe.client.get_list)
function po_find_linked_contact(doctype, name) {
	return frappe
		.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Dynamic Link",
				parent: "Contact",
				filters: {
					parenttype: "Contact",
					link_doctype: doctype,
					link_name: name,
				},
				fields: ["parent"],
				limit_page_length: 1,
			},
		})
		.then((r) => (r.message && r.message.length ? r.message[0].parent : ""));
}

// Default contact: Customer's primary contact, else first linked Contact
function po_get_default_contact(doctype, name) {
	if (doctype === "Customer") {
		return frappe.db
			.get_value("Customer", name, "customer_primary_contact")
			.then((r) => {
				const primary = r.message && r.message.customer_primary_contact;
				return primary || po_find_linked_contact(doctype, name);
			});
	}
	return po_find_linked_contact(doctype, name);
}

// Default company address + dispatch address + company contact
function po_set_company_defaults(frm) {
	const company = po_get_company(frm);
	if (!company) return;

	if (!frm.doc.company_address || !frm.doc.dispatch_address_name) {
		po_get_default_address("Company", company).then((addr) => {
			if (!addr) return;
			if (!frm.doc.company_address) frm.set_value("company_address", addr);
			if (!frm.doc.dispatch_address_name) frm.set_value("dispatch_address_name", addr);
		});
	}
	if (!frm.doc.company_contact_person) {
		po_get_default_contact("Company", company).then((contact) => {
			if (contact) frm.set_value("company_contact_person", contact);
		});
	}
}

frappe.ui.form.on("Projection Order", {
	setup(frm) {
		// items
		frm.set_query("item_code", "items", function () {
			return {
				query: "erpnext.controllers.queries.item_query",
				filters: { is_stock_item: 1 },
			};
		});

		// warehouses filtered by company (item rows + header warehouse)
		frm.set_query("warehouse", "items", po_warehouse_query(frm));
		frm.set_query("warehouse", po_warehouse_query(frm));

		// customer addresses
		const customer_address_q = po_address_query("Customer", (doc) => doc.customer);
		frm.set_query("customer_address", customer_address_q);
		frm.set_query("shipping_address_name", customer_address_q);

		// company addresses
		const company_address_q = po_address_query("Company", () => po_get_company(frm));
		frm.set_query("dispatch_address_name", company_address_q);
		frm.set_query("company_address", company_address_q);

		// contacts
		frm.set_query("contact_person", po_contact_query("Customer", (doc) => doc.customer));
		frm.set_query(
			"company_contact_person",
			po_contact_query("Company", () => po_get_company(frm))
		);
	},

	refresh(frm) {
		if (!frm.doc.material_request_type) {
			frm.set_value("material_request_type", "Manufacture");
		}
		if (frm.is_new() && frm.doc.docstatus === 0) {
			po_set_company_defaults(frm);
		}

		// Create > Material Request (only after submit, and only if no MR is linked yet)
		if (
			frm.doc.docstatus === 1 &&
			!po_has_material_request(frm) &&
			frappe.model.can_create("Material Request")
		) {
			frm.add_custom_button(
				__("Material Request"),
				() => po_make_material_request(frm),
				__("Create")
			);
		}
	},

	company(frm) {
		Promise.all([
			frm.set_value("company_address", ""),
			frm.set_value("company_address_display", ""),
			frm.set_value("dispatch_address_name", ""),
			frm.set_value("dispatch_address", ""),
			frm.set_value("company_contact_person", ""),
		]).then(() => {
			po_set_company_defaults(frm);
		});
	},

	// ----- customer -----
	customer(frm) {
		if (!frm.doc.customer) {
			frm.set_value("customer_group", "");
			frm.set_value("territory", "");
			frm.set_value("customer_address", "");
			frm.set_value("shipping_address_name", "");
			frm.set_value("contact_person", "");
			return;
		}

		frappe.db
			.get_value("Customer", frm.doc.customer, ["customer_group", "territory"])
			.then((r) => {
				const v = r.message || {};
				frm.set_value("customer_group", v.customer_group || "");
				frm.set_value("territory", v.territory || "");
			});

		po_get_default_address("Customer", frm.doc.customer).then((addr) => {
			frm.set_value("customer_address", addr || "");
			// shipping defaults to the same address; change it if different
			frm.set_value("shipping_address_name", addr || "");
		});

		po_get_default_contact("Customer", frm.doc.customer).then((contact) => {
			frm.set_value("contact_person", contact || "");
		});
	},

	// ----- customer (billing) address -----
	customer_address(frm) {
		po_set_address_display(frm, "customer_address", "address_display");

		if (!frm.doc.customer_address) {
			frm.set_value("place_of_supply", "");
			return;
		}

		// GSTIN and GST Category come from fetch_from; Place of Supply is set here
		frappe.db
			.get_value("Address", frm.doc.customer_address, ["gst_state", "gst_state_number"])
			.then((r) => {
				const v = r.message || {};
				if (v.gst_state_number && v.gst_state) {
					frm.set_value("place_of_supply", `${v.gst_state_number}-${v.gst_state}`);
				}
			});
	},

	// ----- shipping address -----
	shipping_address_name(frm) {
		po_set_address_display(frm, "shipping_address_name", "shipping_address");
	},

	// ----- dispatch address -----
	dispatch_address_name(frm) {
		po_set_address_display(frm, "dispatch_address_name", "dispatch_address");
	},

	// ----- company address (company_gstin comes from fetch_from) -----
	company_address(frm) {
		po_set_address_display(frm, "company_address", "company_address_display");
	},

	// ----- customer contact -----
	contact_person(frm) {
		if (!frm.doc.contact_person) {
			po_clear_contact(frm);
			return;
		}
		frappe
			.call({
				method: "frappe.contacts.doctype.contact.contact.get_contact_details",
				args: { contact: frm.doc.contact_person },
			})
			.then((r) => {
				const d = r.message || {};
				frm.set_value("contact_display", d.contact_display || "");
				frm.set_value("contact_phone", d.contact_phone || "");
				frm.set_value("contact_mobile", d.contact_mobile || "");
				frm.set_value("contact_email", d.contact_email || "");
			});
	},

	// push header "Required By" to all item rows
	schedule_date(frm) {
		if (!frm.doc.schedule_date) return;
		(frm.doc.items || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "schedule_date", frm.doc.schedule_date);
		});
	},

	// push header warehouse to all item rows
	warehouse(frm) {
		if (!frm.doc.warehouse) return;
		(frm.doc.items || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "warehouse", frm.doc.warehouse);
		});
	},
});

frappe.ui.form.on("Material Request Item", {
	items_add(frm, cdt, cdn) {
		if (frm.doctype !== "Projection Order") return;
		const row = locals[cdt][cdn];
		if (!row.schedule_date && frm.doc.schedule_date) {
			frappe.model.set_value(cdt, cdn, "schedule_date", frm.doc.schedule_date);
		}
		if (!row.warehouse && frm.doc.warehouse) {
			frappe.model.set_value(cdt, cdn, "warehouse", frm.doc.warehouse);
		}
	},

	item_code(frm, cdt, cdn) {
		if (frm.doctype !== "Projection Order") return;
		const row = locals[cdt][cdn];
		if (!row.item_code) return;

		frappe.call({
			method: "erpnext.stock.get_item_details.get_item_details",
			args: {
				// v16: first parameter is `ctx` (was `args` in older versions)
				ctx: {
					item_code: row.item_code,
					set_warehouse: "",
					warehouse: row.warehouse || frm.doc.warehouse || "",
					doctype: "Material Request",
					buying_price_list: frappe.defaults.get_default("buying_price_list"),
					currency: frappe.defaults.get_default("Currency"),
					name: frm.doc.name,
					qty: row.qty || 1,
					stock_qty: row.stock_qty,
					company: po_get_company(frm),
					conversion_rate: 1,
					material_request_type: frm.doc.material_request_type,
					plc_conversion_rate: 1,
					rate: row.rate,
					uom: row.uom,
					conversion_factor: row.conversion_factor,
				},
			},
			callback(r) {
				const d = r.message;
				if (!d) return;

				PO_ITEM_FIELDS.forEach((field) => {
					if (d[field] !== undefined && d[field] !== null) {
						frappe.model.set_value(cdt, cdn, field, d[field]);
					}
				});

				if (!row.qty) {
					frappe.model.set_value(cdt, cdn, "qty", 1);
				}
				if (!row.schedule_date && frm.doc.schedule_date) {
					frappe.model.set_value(cdt, cdn, "schedule_date", frm.doc.schedule_date);
				}
				if (!d.warehouse && frm.doc.warehouse) {
					frappe.model.set_value(cdt, cdn, "warehouse", frm.doc.warehouse);
				}

				po_recalculate_row(cdt, cdn);
			},
		});
	},

	uom(frm, cdt, cdn) {
		if (frm.doctype !== "Projection Order") return;
		const row = locals[cdt][cdn];
		if (!row.item_code || !row.uom) return;

		frappe.call({
			method: "erpnext.stock.get_item_details.get_conversion_factor",
			args: { item_code: row.item_code, uom: row.uom },
			callback(r) {
				if (r.message && r.message.conversion_factor) {
					frappe.model.set_value(cdt, cdn, "conversion_factor", r.message.conversion_factor);
				}
			},
		});
	},

	qty(frm, cdt, cdn) {
		if (frm.doctype !== "Projection Order") return;
		po_recalculate_row(cdt, cdn);
	},

	conversion_factor(frm, cdt, cdn) {
		if (frm.doctype !== "Projection Order") return;
		po_recalculate_row(cdt, cdn);
	},

	rate(frm, cdt, cdn) {
		if (frm.doctype !== "Projection Order") return;
		po_recalculate_row(cdt, cdn);
	},
});