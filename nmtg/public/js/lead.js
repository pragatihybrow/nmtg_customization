frappe.ui.form.on('Lead', {
    custom_customer_type: function(frm) {
        frm.set_value('custom_industry_ct', []);
        frm.set_value('custom_application', []);
        set_industry_filter(frm);
    },

    custom_industry_ct: function(frm) {
        frm.set_value('custom_application', []);
        set_application_filter(frm);
    },

    onload: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        set_first_row_name(frm);
        toggle_qualification_gated_buttons(frm);
        override_prospect_button(frm);
        override_quotation_button(frm);
        // override_opportunity_button(frm);
        override_customer_button(frm);
    },
    refresh: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        set_first_row_name(frm);
        setTimeout(() => toggle_qualification_gated_buttons(frm), 500);
        override_prospect_button(frm);
        override_quotation_button(frm);
        // override_opportunity_button(frm);
        override_customer_button(frm);
        render_email_preview(frm);
    },

    first_name(frm) {
        set_first_row_name(frm);
    },
    company_name(frm) {
        set_first_row_name(frm);
    },
    qualification_status: function (frm) {
		render_email_preview(frm);
	},
});


function toggle_qualification_gated_buttons(frm) {
    if (frm.doc.workflow_state === "Qualified") return;

    frm.remove_custom_button("Customer", "Create");
    frm.remove_custom_button("Opportunity", "Create");
    frm.remove_custom_button("Quotation", "Create");
    frm.remove_custom_button("Prospect", "Create");
    frm.remove_custom_button("Add to Prospect", "Action");
}

function set_industry_filter(frm) {
    const customer_types = (frm.doc.custom_customer_type || [])
        .map(row => row.customer_type)
        .filter(Boolean);

    if (!customer_types.length) {
        frm.set_query('custom_industry_ct', () => ({ filters: [] }));
        return;
    }

    Promise.all(
        customer_types.map(ct =>
            frappe.db.get_doc('Customer Type', ct).catch(() => null)
        )
    ).then(docs => {
        const industry_names = [
            ...new Set(
                docs
                    .filter(Boolean)
                    .flatMap(doc => (doc.industry || []).map(row => row.industry).filter(Boolean))
            )
        ];

        frm.set_query('custom_industry_ct', function() {
            if (!industry_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', industry_names]] };
        });
    });
}

function set_application_filter(frm) {
    const industries = (frm.doc.custom_industry_ct || [])
        .map(row => row.industry)
        .filter(Boolean);

    if (!industries.length) {
        frm.set_query('custom_application', () => ({ filters: [] }));
        return;
    }

    Promise.all(
        industries.map(ind =>
            frappe.db.get_doc('Industry', ind).catch(() => null)
        )
    ).then(docs => {
        const application_names = [
            ...new Set(
                docs
                    .filter(Boolean)
                    .flatMap(doc => (doc.application || []).map(row => row.application).filter(Boolean))
            )
        ];

        frm.set_query('custom_application', function() {
            if (!application_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', application_names]] };
        });
    });
}

function set_first_row_name(frm) {
    let cname = frm.doc.first_name || frm.doc.company_name || '';
    if (!cname) return;

    if (!frm.doc.custom_contact_info || !frm.doc.custom_contact_info.length) {
        let row = frm.add_child('custom_contact_info');
        row.name1 = cname;
    } else {
        let row = frm.doc.custom_contact_info[0];
        // don't clobber a row once it's linked to an actual Contact
        if (row.name1 !== cname && !row.custom_contact_ref) {
            frappe.model.set_value(row.doctype, row.name, 'name1', cname);
        }
    }
    frm.refresh_field('custom_contact_info');
}

frappe.ui.form.on('Lead Contact Info', {
    email_id(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    contact_no(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    whatsapp_no(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    designation(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    name1(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); }
});

const debounced_sync_contact = frappe.utils.debounce(sync_contact, 800);

function sync_contact(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!row.name1) return;
    if (!row.email_id && !row.contact_no && !row.whatsapp_no) return;

    frappe.call({
        method: "nmtg.override.api.create_or_update_lead_contact",
        args: {
            row: row,
            lead: frm.doc.name
        },
        callback: function (r) {
            if (r.message) {
                frappe.model.set_value(cdt, cdn, 'custom_contact_ref', r.message);
            }

            
            frappe.call({
                method: 'frappe.client.get_value',
                args: {
                    doctype: 'Lead',
                    filters: frm.doc.name,
                    fieldname: 'modified'
                },
                callback: function (res) {
                    if (res.message && res.message.modified) {
                        frm.doc.modified = res.message.modified;
                    }
                }
            });
        }
    });
}


function copy_custom_field(values, target_doctype, frm, source_fieldname, target_fieldname) {
	target_fieldname = target_fieldname || source_fieldname;

	if (!frappe.meta.has_field(target_doctype, target_fieldname)) return;

	let df = frappe.meta.get_docfield(target_doctype, target_fieldname);
	let value = frm.doc[source_fieldname];
	if (value === undefined || value === null) return;

	if (df.fieldtype === "Table" || df.fieldtype === "Table MultiSelect") {
		if (!Array.isArray(value)) return;
		values[target_fieldname] = value.map((row) => {
			let clean = {};
			Object.keys(row).forEach((key) => {
				if (
					!["name", "owner", "creation", "modified", "modified_by", "parent", "parentfield", "parenttype", "doctype", "idx", "docstatus"].includes(key)
				) {
					clean[key] = row[key];
				}
			});
			return clean;
		});
	} else {
		values[target_fieldname] = value;
	}
}

function route_to_new_doc(doctype, values) {
	frappe.route_options = values;
	frappe.new_doc(doctype);
}


/* ---------------------------------------------------------------------
 * Prospect
 * ------------------------------------------------------------------- */
function override_prospect_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Prospect", "Create");
	frm.add_custom_button(__("Prospect"), () => make_prospect_from_lead(frm), __("Create"));
}

function make_prospect_from_lead(frm) {
	frappe.model.with_doctype("Prospect", () => {
		let values = {};

		// standard field mapping
		values.company_name = frm.doc.company_name;
		values.no_of_employees = frm.doc.no_of_employees;
		values.annual_revenue = frm.doc.annual_revenue;
		values.industry = frm.doc.industry;
		values.market_segment = frm.doc.market_segment;
		values.territory = frm.doc.territory;
		values.website = frm.doc.website;
		values.fax = frm.doc.fax;
		values.city = frm.doc.city;
		values.state = frm.doc.state;
		values.country = frm.doc.country;

		// link back to originating lead
		values.leads = [{
			lead: frm.doc.name,
			lead_name: frm.doc.lead_name,
			lead_owner: frm.doc.lead_owner,
		}];

		// custom fields — same fieldname on both sides
		[
			"custom_approx_annual_requirement",
			"custom_requirement_timeline",
			"custom_product_group",
			"custom_application",
			"custom_industry_ct",
			"custom_customer_type",
			"custom_contact_info",
			"custom_product_intrest",
		].forEach((fieldname) => copy_custom_field(values, "Prospect", frm, fieldname));

		// renamed on Lead (trailing underscore) vs Prospect
		copy_custom_field(values, "Prospect", frm, "custom_annual_turnover_", "custom_annual_turnover");
		copy_custom_field(values, "Prospect", frm, "custom_application_description_", "custom_application_description_");

		route_to_new_doc("Prospect", values);
	});
}


/* ---------------------------------------------------------------------
 * Opportunity
 * ------------------------------------------------------------------- */
function override_opportunity_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Opportunity", "Create");
	frm.add_custom_button(__("Opportunity"), () => make_opportunity_from_lead(frm), __("Create"));
}

function make_opportunity_from_lead(frm) {
	frappe.model.with_doctype("Opportunity", () => {
		let values = {};

		values.opportunity_from = "Lead";
		values.party_name = frm.doc.name;
		values.customer_name = frm.doc.company_name || frm.doc.lead_name;

		// standard field mapping
		values.no_of_employees = frm.doc.no_of_employees;
		values.annual_revenue = frm.doc.annual_revenue;
		values.industry = frm.doc.industry;
		values.market_segment = frm.doc.market_segment;
		values.territory = frm.doc.territory;
		values.website = frm.doc.website;
		values.city = frm.doc.city;
		values.state = frm.doc.state;
		values.country = frm.doc.country;

		// custom fields — same fieldname on both sides
		[
			"custom_approx_annual_requirement",
			"custom_requirement_timeline",
			"custom_product_group",
			"custom_application",
			"custom_industry_ct",
			"custom_customer_type",
			"custom_product_intrest",
		].forEach((fieldname) => copy_custom_field(values, "Opportunity", frm, fieldname));

		// renamed on Lead (trailing underscore) vs Opportunity
		copy_custom_field(values, "Opportunity", frm, "custom_annual_turnover_", "custom_annual_turnover");
		copy_custom_field(values, "Opportunity", frm, "custom_application_description_", "custom_application_description");

		route_to_new_doc("Opportunity", values);
	});
}


/* ---------------------------------------------------------------------
 * Quotation
 * ------------------------------------------------------------------- */
function override_quotation_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Quotation", "Create");
	frm.add_custom_button(__("Quotation"), () => make_quotation_from_lead(frm), __("Create"));
}

function make_quotation_from_lead(frm) {
	frappe.model.with_doctype("Quotation", () => {
		let values = {};

		// same ordering concern as Opportunity: quotation_to before party_name
		values.quotation_to = "Lead";
		values.party_name = frm.doc.name;
		values.customer_name = frm.doc.company_name || frm.doc.lead_name;

		// custom fields — same fieldname on both sides
		[
			"custom_customer_type",
			"custom_industry_ct",
			"custom_application",
			"custom_product_group",
			"custom_product_intrest",
		].forEach((fieldname) => copy_custom_field(values, "Quotation", frm, fieldname));

		// renamed on Lead (trailing underscore) vs Quotation
		copy_custom_field(values, "Quotation", frm, "custom_application_description_", "custom_application_description");

		route_to_new_doc("Quotation", values);
	});
}


/* ---------------------------------------------------------------------
 * Customer
 * ------------------------------------------------------------------- */
function override_customer_button(frm) {
	if (frm.doc.workflow_state !== "Qualified") return;

	frm.remove_custom_button("Customer", "Create");
	frm.add_custom_button(__("Customer"), () => make_customer_from_lead(frm), __("Create"));
}

function make_customer_from_lead(frm) {
	frappe.model.with_doctype("Customer", () => {
		let values = {};

		values.customer_name = frm.doc.company_name || frm.doc.lead_name;
		values.lead_name = frm.doc.name; // back-link to originating lead
		values.territory = frm.doc.territory;

		copy_custom_field(values, "Customer", frm, "custom_customer_type", "custom_customer__type");
		copy_custom_field(values, "Customer", frm, "custom_industry_ct", "custom_industrys");
		copy_custom_field(values, "Customer", frm, "custom_application"); // same fieldname on both sides

		route_to_new_doc("Customer", values);
	});
}

function build_signature(sender_name, sender_designation, sender_mobile) {
	return `
		<br><br>Best Regards,<br>
		${frappe.utils.escape_html(sender_name || "")}<br>
		${frappe.utils.escape_html(sender_designation || "")}<br>
		${frappe.utils.escape_html(sender_mobile || "")}<br>
		<a href="https://www.nmtgindia.com" target="_blank">www.nmtgindia.com</a>
	`;
}

// Colorful pill palette — cycles through these for each product group
const BADGE_COLORS = [
	{ bg: "#e3f2fd", fg: "#1565c0" }, // blue
	{ bg: "#e8f5e9", fg: "#2e7d32" }, // green
	{ bg: "#fff3e0", fg: "#e65100" }, // orange
	{ bg: "#f3e5f5", fg: "#6a1b9a" }, // purple
	{ bg: "#fce4ec", fg: "#ad1457" }, // pink
	{ bg: "#e0f7fa", fg: "#00838f" }, // teal
	{ bg: "#fff8e1", fg: "#f9a825" }, // amber
];

// Single, consistent light color scheme used for every stage card in the
// preview accordion — bg/fg for the number badge + chip, and a soft "tint"
// used for the card's left border/background.
const STAGE_COLOR = { bg: "#607d8b", fg: "#ffffff", tint: "#eceff1", border: "#b0bec5" };

const DEFAULT_PRODUCT_GROUPS = [
	"Locking Assemblies",
	"Shrink Discs",
	"Freewheels One-Way Clutches / Holdback Devices",
	"Tensioner Nuts & Bolts",
	"Hydraulic Turning Motor Assembly with Overrunning Clutch",
];

// Maps the JS-side stage key (used in frm._email_preview_stages, and in the
// URL-safe onclick handler) to the actual Lead doctype custom fieldname
// segment. These differ for the follow-up stages: JS uses "followup1" /
// "followup2" (no underscore before the digit) while the actual custom
// fields on the Lead doctype are custom_followup_1_email_sent /
// custom_followup_2_email_sent (underscore before the digit). Keeping this
// map in one place avoids the mismatch that caused the "Unknown column
// 'custom_followup1_email_sent'" SQL error.
const STAGE_FIELD_KEY_MAP = {
	intro: "intro",
	followup1: "followup_1",
	followup2: "followup_2",
	final: "final",
};

function get_stage_field_key(stage_key) {
	return STAGE_FIELD_KEY_MAP[stage_key] || stage_key;
}

function build_product_group_badges(product_groups) {
	const groups = product_groups && product_groups.length ? product_groups : DEFAULT_PRODUCT_GROUPS;

	const pills = groups
		.map((name, i) => {
			const c = BADGE_COLORS[i % BADGE_COLORS.length];
			return `<span style="display:inline-block; background:${c.bg}; color:${c.fg}; font-weight:600; font-size:12px; padding:5px 12px; margin:3px 5px 3px 0; border-radius:14px;">${frappe.utils.escape_html(name)}</span>`;
		})
		.join("");

	return `<div style="margin: 6px 0 10px 0;">${pills}</div>`;
}

function get_stage_defs(customer_name, NMTG_SIGNATURE, product_groups) {
	return [
		{
			key: "intro",
			label: "Introduction Email",
			icon: "👋",
			offset_days: 0,
			subject: "Introduction of NMTG Mechtrans Techniques Pvt. Ltd. – Manufacturer of Mechanical Power Transmission Products",
			body: `
				<p>Dear Sir/Madam,</p>
				<p>Greetings from NMTG!</p>
				<p>We are pleased to introduce NMTG, a leading manufacturer of high-performance mechanical
				power transmission components with over 50 years of engineering excellence. Our products are
				designed to deliver reliable performance, precision, and long service life across a wide range
				of industrial applications like gearbox, crusher, pulley, Bucket elevator, Industrial Motor,
				Gas Compression, Pumps, cement, steel, mining, food &amp; packaging machine, Machine tools,
				printing and textile and many more.</p>
				<p>Based on your requirement, we'd like to highlight the following product group(s):</p>
				${build_product_group_badges(product_groups)}
				<p>NMTG is a trusted supplier to several leading OEMs, including Flender Drives, Nishuka,
				Bonfiglioli, Popel Drive, New Allenberry Works, Premium Transmission, Shanthi Gears, TKIL,
				KSB, Sulzer, BTL, Adani, Vedanta, AM/NS and many more.</p>
				<p>We are also supplied in Govt. and PSUs BHEL, SAIL, RINL, NTPC, NMDC, NLC, Andrew Yule,
				BCCL, HCL and many more.</p>
				<p>Our engineering expertise, consistent quality, and application support make us a preferred
				partner for OEMs seeking reliable and cost-effective power transmission solutions.</p>
				<p>We would appreciate the opportunity to discuss your current or upcoming requirements and
				explore how NMTG can support your business.</p>
				<p>We look forward to hearing from you.</p>
				${NMTG_SIGNATURE}
			`,
		},
		{
			key: "followup1",
			label: "Follow-up 1",
			icon: "📩",
			offset_days: 3,
			subject: "Gentle Follow-Up on Our Introduction – NMTG",
			body: `
				<p>Dear ${customer_name},</p>
				<p>I hope you are doing well.</p>
				<p>We are writing to follow up on our introductory email and to confirm that you had an
				opportunity to review our company profile and product brochure.</p>
				<p>We would be pleased to understand your current or upcoming requirements and discuss how
				NMTG can support your business with our products and services.</p>
				<p>If you have any questions or would like additional information, please let us know. We
				will be happy to assist you.</p>
				<p>We look forward to hearing from you.</p>
				${NMTG_SIGNATURE}
			`,
		},
		{
			key: "followup2",
			label: "Follow-up 2",
			icon: "🔁",
			offset_days: 7, // days after followup1
			subject: "Follow-Up: Introduction to NMTG Power Transmission Solutions",
			body: `
				<p>Dear ${customer_name},</p>
				<p>Greetings from NMTG.</p>
				<p>We are following up regarding our previous communication. I understand you may have a
				busy schedule, but once you see our profile, please let us know if your organization has any
				current or upcoming requirements that we can assist with.</p>
				<p>Our team is ready to provide product information, technical support, and competitive
				quotations based on your needs.</p>
				<p>Please let us know if there is a convenient time to discuss your requirements. We would
				be delighted to support your business.</p>
				<p>We look forward to your response.</p>
				${NMTG_SIGNATURE}
			`,
		},
		{
			key: "final",
			label: "Final Follow-up",
			icon: "🚪",
			offset_days: 15, // days after followup2
			subject: "Keeping the Door Open – NMTG Power Transmission Solutions",
			body: `
				<p>Dear ${customer_name},</p>
				<p>I hope you are doing well.</p>
				<p>This is a final follow-up regarding our previous emails introducing NMTG and our product
				range.</p>
				<p>We understand that priorities can change, and you may not have an immediate requirement
				at this time. However, we would be pleased to be considered for any future opportunities
				where our products and services may be of value.</p>
				<p>For your convenience, we have attached our latest product brochure once again for your
				reference.</p>
				<p>Thank you for your time. We look forward to the opportunity to work with you whenever a
				requirement arises.</p>
				${NMTG_SIGNATURE}
			`,
		},
	];
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render_email_preview(frm) {
	const $wrapper = frm.fields_dict.custom_email && frm.fields_dict.custom_email.$wrapper;
	if (!$wrapper) return;

	if (frm.doc.qualification_status !== "Qualified") {
		$wrapper.html(`
			<div class="text-muted" style="padding: 10px;">
				This preview appears once <b>Qualification Status</b> is set to <b>Qualified</b>.
				No email is sent automatically — this is a reference schedule only.
			</div>
		`);
		return;
	}

	const customer_name = frm.doc.lead_name || frm.doc.company_name || "Sir/Madam";
	const anchor_str = frm.doc.qualified_on || frappe.datetime.get_today();
	const product_groups = (frm.doc.custom_product_group || [])
		.map((row) => row.product_group)
		.filter(Boolean);

	$wrapper.html(`<div class="text-muted" style="padding: 10px;">Loading email preview…</div>`);

	// Sender name and designation are already on the Lead (fetched from Lead
	// Owner). Mobile No is not, so fetch it from the User record directly.
	const get_mobile = frm.doc.lead_owner
		? frappe.db.get_value("User", frm.doc.lead_owner, "mobile_no")
		: Promise.resolve({ message: {} });

	get_mobile.then((r) => {
		const sender_name = frm.doc.custom_lead_owner_name || "";
		const sender_designation = frm.doc.job_title || "";
		const sender_mobile = (r.message && r.message.mobile_no) || "";

		render_preview_body(
			frm,
			$wrapper,
			customer_name,
			anchor_str,
			build_signature(sender_name, sender_designation, sender_mobile),
			product_groups
		);
	});
}

// function render_preview_body(frm, $wrapper, customer_name, anchor_str, NMTG_SIGNATURE, product_groups) {
// 	const stages = get_stage_defs(customer_name, NMTG_SIGNATURE, product_groups);
//     frm._email_preview_stages = stages;

// 	let cumulative_days = 0;
//     const recipient_email = get_last_contact_email(frm);
// 	const rows = stages
// 		.map((stage, i) => {
// 			cumulative_days += stage.offset_days;
// 			const due_date = frappe.datetime.add_days(anchor_str, cumulative_days);
// 			const c = STAGE_COLOR;
// 			const panel_id = `stage-panel-${stage.key}`;
// 			const arrow_id = `stage-arrow-${stage.key}`;

// 			const field_key = get_stage_field_key(stage.key);
// 			const already_sent = frm.doc[`custom_${field_key}_email_sent`];
// 			const send_control = already_sent
// 				? `<span style="font-size:11px; font-weight:600; color:#2e7d32; background:#e8f5e9; padding:3px 10px; border-radius:10px;">✓ Sent</span>`
// 				: `<button type="button"
// 					class="btn btn-xs btn-default"
// 					style="font-size:11px;"
// 					onclick="event.stopPropagation(); send_lead_stage_email_ui('${stage.key}');">
// 					Send
// 				</button>`;

// 			return `
// 			<div style="border:1px solid ${c.border}; border-left:4px solid ${c.bg}; border-radius:8px; margin-bottom:10px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
// 				<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; cursor:pointer; background:${c.tint};"
// 					 onclick="
// 						var b=document.getElementById('${panel_id}');
// 						var a=document.getElementById('${arrow_id}');
// 						var open = b.style.display !== 'none';
// 						b.style.display = open ? 'none' : 'block';
// 						a.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
// 					 ">
// 					<div style="display:flex; align-items:center; gap:10px;">
// 						<span style="display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; background:${c.bg}; color:${c.fg}; font-weight:700; font-size:12px; flex-shrink:0;">${i + 1}</span>
// 						<div>
// 							<div style="font-weight:700; color:${c.bg};">${stage.icon ? stage.icon + " " : ""}${frappe.utils.escape_html(stage.label)}</div>
// 							<div style="font-size:12px; color:var(--text-muted);">
// 								<span style="display:inline-block; background:${c.bg}22; color:${c.bg}; font-weight:600; padding:1px 8px; border-radius:10px; margin-top:3px;">
// 									Planned for ${frappe.datetime.str_to_user(due_date)}
// 								</span>
// 							</div>
// 						</div>
// 					</div>
//                     <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
// 						${send_control}
// 						<span id="${arrow_id}" style="font-size:14px; color:${c.bg}; transition:transform 0.15s ease;">▾</span>
// 					</div>
// 				</div>
// 				<div id="${panel_id}" style="display:none; border-top:1px solid ${c.border}; padding:14px; background:var(--fg-color);">
// 					<div style="font-size:11px; letter-spacing:.03em; text-transform:uppercase; color:${c.bg}; font-weight:700; margin-bottom:4px;">Subject</div>
// 					<div style="font-weight:600; margin-bottom:12px; padding:8px 10px; background:${c.tint}; border-radius:6px;">${frappe.utils.escape_html(stage.subject)}</div>
// 					<div style="font-size:11px; letter-spacing:.03em; text-transform:uppercase; color:${c.bg}; font-weight:700; margin-bottom:4px;">Body Preview</div>
// 					<div style="background:var(--subtle-fg); border:1px solid var(--border-color); border-radius:6px; padding:10px; max-height:260px; overflow:auto;">
// 						${stage.body}
// 					</div>
// 				</div>
// 			</div>`;
// 		})
// 		.join("");

// 	$wrapper.html(`
// 		<div style="padding: 6px 0;">
// 			<div style="margin-bottom:12px; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
// 				${recipient_email ? `Recipient: <b>${frappe.utils.escape_html(recipient_email)}</b>` : `<span style="color:#c62828;">No recipient email set on last Contact Info row</span>`}
// 			</div>
// 			${rows}
// 		</div>
// 	`);
// }

function render_preview_body(frm, $wrapper, customer_name, anchor_str, NMTG_SIGNATURE, product_groups) {
	const stages = get_stage_defs(customer_name, NMTG_SIGNATURE, product_groups);
    frm._email_preview_stages = stages;

    const recipient_email = get_last_contact_email(frm);

    // Two parallel walks over the stages:
    // 1) original_cumulative_days — fixed offsets from anchor_str (qualified_on),
    //    exactly as originally planned, ignoring what actually happened.
    // 2) chained_reference_date — the "live" plan, which re-anchors off each
    //    stage's actual sent date once it's been sent (falls back to that
    //    stage's own chained due date if not sent yet).
    let original_cumulative_days = 0;
    let chained_reference_date = anchor_str;

	const rows = stages
		.map((stage, i) => {
			const c = STAGE_COLOR;
			const panel_id = `stage-panel-${stage.key}`;
			const arrow_id = `stage-arrow-${stage.key}`;

			const field_key = get_stage_field_key(stage.key);
			const already_sent = frm.doc[`custom_${field_key}_email_sent`];
			const sent_on = frm.doc[`custom_${field_key}_email_sent_on`];

			// original plan, untouched by reality
			original_cumulative_days += stage.offset_days;
			const original_due_date = frappe.datetime.add_days(anchor_str, original_cumulative_days);

			// live/chained plan
			const chained_due_date = frappe.datetime.add_days(chained_reference_date, stage.offset_days);
			// advance the chain for the next stage: use this stage's actual
			// sent date if available, else its chained due date
			chained_reference_date = sent_on || chained_due_date;

			let date_lines;
			if (already_sent) {
				date_lines = `
					<span style="display:inline-block; background:${c.bg}22; color:${c.bg}; font-weight:600; padding:1px 8px; border-radius:10px; margin-top:3px;">
						Originally planned for ${frappe.datetime.str_to_user(original_due_date)}
					</span>`;
			} else if (chained_due_date === original_due_date) {
				date_lines = `
					<span style="display:inline-block; background:${c.bg}22; color:${c.bg}; font-weight:600; padding:1px 8px; border-radius:10px; margin-top:3px;">
						Planned for ${frappe.datetime.str_to_user(chained_due_date)}
					</span>`;
			} else {
				date_lines = `
					<span style="display:inline-block; background:${c.bg}22; color:${c.bg}; font-weight:600; padding:1px 8px; border-radius:10px; margin-top:3px; margin-right:6px;">
						Originally planned for ${frappe.datetime.str_to_user(original_due_date)}
					</span>
					<span style="display:inline-block; background:${c.bg}22; color:${c.bg}; font-weight:600; padding:1px 8px; border-radius:10px; margin-top:3px;">
						Now planned for ${frappe.datetime.str_to_user(chained_due_date)}
					</span>`;
			}

			const send_control = already_sent
				? `<span style="font-size:11px; font-weight:600; color:#2e7d32; background:#e8f5e9; padding:3px 10px; border-radius:10px;">
					✓ Sent${sent_on ? ` on ${frappe.datetime.str_to_user(sent_on)}` : ""}
				   </span>`
				: `<button type="button"
					class="btn btn-xs btn-default"
					style="font-size:11px;"
					onclick="event.stopPropagation(); send_lead_stage_email_ui('${stage.key}');">
					Send
				</button>`;

			return `
			<div style="border:1px solid ${c.border}; border-left:4px solid ${c.bg}; border-radius:8px; margin-bottom:10px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
				<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; cursor:pointer; background:${c.tint};"
					 onclick="
						var b=document.getElementById('${panel_id}');
						var a=document.getElementById('${arrow_id}');
						var open = b.style.display !== 'none';
						b.style.display = open ? 'none' : 'block';
						a.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
					 ">
					<div style="display:flex; align-items:center; gap:10px;">
						<span style="display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; background:${c.bg}; color:${c.fg}; font-weight:700; font-size:12px; flex-shrink:0;">${i + 1}</span>
						<div>
							<div style="font-weight:700; color:${c.bg};">${stage.icon ? stage.icon + " " : ""}${frappe.utils.escape_html(stage.label)}</div>
							<div style="font-size:12px; color:var(--text-muted);">
								${date_lines}
							</div>
						</div>
					</div>
                    <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
						${send_control}
						<span id="${arrow_id}" style="font-size:14px; color:${c.bg}; transition:transform 0.15s ease;">▾</span>
					</div>
				</div>
				<div id="${panel_id}" style="display:none; border-top:1px solid ${c.border}; padding:14px; background:var(--fg-color);">
					<div style="font-size:11px; letter-spacing:.03em; text-transform:uppercase; color:${c.bg}; font-weight:700; margin-bottom:4px;">Subject</div>
					<div style="font-weight:600; margin-bottom:12px; padding:8px 10px; background:${c.tint}; border-radius:6px;">${frappe.utils.escape_html(stage.subject)}</div>
					<div style="font-size:11px; letter-spacing:.03em; text-transform:uppercase; color:${c.bg}; font-weight:700; margin-bottom:4px;">Body Preview</div>
					<div style="background:var(--subtle-fg); border:1px solid var(--border-color); border-radius:6px; padding:10px; max-height:260px; overflow:auto;">
						${stage.body}
					</div>
				</div>
			</div>`;
		})
		.join("");

	$wrapper.html(`
		<div style="padding: 6px 0;">
			<div style="margin-bottom:12px; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
				${recipient_email ? `Recipient: <b>${frappe.utils.escape_html(recipient_email)}</b>` : `<span style="color:#c62828;">No recipient email set on last Contact Info row</span>`}
			</div>
			${rows}
		</div>
	`);
}

function get_last_contact_email(frm) {
	const rows = frm.doc.custom_contact_info || [];
	if (!rows.length) return null;
	return rows[rows.length - 1].email_id || null;
}

function send_lead_stage_email_ui(stage_key) {
	const frm = cur_frm;
	if (!frm || frm.doc.doctype !== "Lead") return;

	const stage = (frm._email_preview_stages || []).find(s => s.key === stage_key);
	if (!stage) return;

	const recipient_email = get_last_contact_email(frm);
	if (!recipient_email) {
		frappe.msgprint(__("The last row in Contact Info has no email address. Add one before sending."));
		return;
	}

	frappe.confirm(
		__("Send \"{0}\" to {1}?", [stage.label, recipient_email]),
		() => {
			frappe.call({
				method: "nmtg.override.api.send_lead_stage_email",
				args: {
					lead: frm.doc.name,
					stage_key: stage.key,
					subject: stage.subject,
					message: stage.body,
				},
				freeze: true,
				freeze_message: __("Sending email…"),
				callback: function (r) {
					if (!r.exc && r.message) {
						const field_key = get_stage_field_key(stage.key);
						frm.doc[`custom_${field_key}_email_sent`] = 1;
						frm.doc[`custom_${field_key}_email_sent_on`] = r.message.sent_on;
						frappe.show_alert({ message: __("Email sent to {0}", [recipient_email]), indicator: "green" });
						render_email_preview(frm);
					}
				}
			});
		}
	);
}
window.send_lead_stage_email_ui = send_lead_stage_email_ui;