frappe.ui.form.on('Prospect', {
    onload: function(frm) {
        render_email_preview(frm);

		if (frm.is_new() && !frm.doc.prospect_owner) {
			frm.set_value("prospect_owner", frappe.session.user);
		}
		
    },
    refresh: function(frm) {
        render_email_preview(frm);
    },
});

function build_signature(sender_name, sender_designation, sender_mobile) {
	return `
		<br><br>Best Regards,<br>
		${frappe.utils.escape_html(sender_name || "")}<br>
		${frappe.utils.escape_html(sender_designation || "")}<br>
		${frappe.utils.escape_html(sender_mobile || "")}<br>
		<a href="https://www.nmtgindia.com" target="_blank">www.nmtgindia.com</a>
	`;
}

const STAGE_COLOR = { bg: "#607d8b", fg: "#ffffff", tint: "#eceff1", border: "#b0bec5" };

const STAGE_FIELD_KEY_MAP = {
	intro: "intro",
	followup1: "followup_1",
	followup2: "followup_2",
	final: "final",
};

function get_stage_field_key(stage_key) {
	return STAGE_FIELD_KEY_MAP[stage_key] || stage_key;
}

function get_stage_defs(customer_name, NMTG_SIGNATURE, dynamic_values) {
	const dv = dynamic_values || { industry: "your", application: "your", product_group: "our", customer_type: "your", product_group_list: [] };

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
				<p>We are pleased to introduce NMTG Mechtrans Techniques Pvt. Ltd., a leading manufacturer of
				high-performance mechanical power transmission products with over 50 years of engineering
				excellence.</p>
				<p>Considering your ${frappe.utils.escape_html(dv.industry)} industry and
				${frappe.utils.escape_html(dv.application)} application, our
				${frappe.utils.escape_html(dv.product_group)} range may be suitable for your current and
				upcoming requirements.</p>
				<p>Our complete product range includes:</p>
				<ul>
					<li>Locking Assemblies</li>
					<li>Shrink Discs</li>
					<li>Freewheels, One-Way Clutches and Holdback Devices</li>
					<li>Tensioner Nuts and Bolts</li>
					<li>Hydraulic Turning Motor Assemblies with Overrunning Clutches</li>
				</ul>
				<p>Our products are designed to deliver reliable performance, precision, and long service life
				across applications such as gearboxes, crushers, pulleys, bucket elevators, industrial motors,
				gas compressors, pumps, cement plants, steel plants, mining equipment, food and packaging
				machinery, machine tools, printing machinery, textile machinery, and many more.</p>
				<p>NMTG is a trusted supplier to several leading OEMs and industrial organizations, including
				Flender Drives, Hero Motors, ABB, GE Vernova, Siemens, Caterpillar, TKIL Industries,
				Bonfiglioli, KSB, Sulzer, Adani, Vedanta, AM/NS India, and many others.</p>
				<p>We have also supplied our products to government organizations and public-sector
				undertakings such as BHEL, SAIL, RINL, NTPC, NMDC, NLC India, Andrew Yule, BCCL, HCL, and
				others.</p>
				<p>Our engineering expertise, consistent quality, and application support make us a preferred
				partner for reliable and cost-effective mechanical power transmission solutions.</p>
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
			offset_days: 7,
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
			offset_days: 15,
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

	if (frm.doc.__islocal) {
		$wrapper.html(`
			<div class="text-muted" style="padding: 10px;">
				Save the Prospect to see the email preview.
			</div>
		`);
		return;
	}

	const customer_name = frm.doc.company_name || "Sir/Madam";
	// ASSUMPTION: Prospect has no "qualified_on" style field — anchoring on
	// creation date. Swap this for the right field if you have one.
	const anchor_str = frm.doc.creation
		? frappe.datetime.str_to_obj(frm.doc.creation).toISOString().slice(0, 10)
		: frappe.datetime.get_today();

	$wrapper.html(`<div class="text-muted" style="padding: 10px;">Loading email preview…</div>`);

	const get_owner_info = frm.doc.prospect_owner
		? frappe.db.get_value("User", frm.doc.prospect_owner, ["mobile_no", "full_name"])
		: Promise.resolve({ message: {} });

	Promise.all([get_owner_info, get_dynamic_prospect_values(frm), get_prospect_recipients(frm)])
		.then(([r, dynamic_values, recipients]) => {
			const sender_name = (r.message && r.message.full_name) || "";
			const sender_mobile = (r.message && r.message.mobile_no) || "";

			render_preview_body(
				frm,
				$wrapper,
				customer_name,
				anchor_str,
				build_signature(sender_name, "", sender_mobile),
				dynamic_values,
				recipients
			);
		});
}

function render_preview_body(frm, $wrapper, customer_name, anchor_str, NMTG_SIGNATURE, dynamic_values, recipients) {
	const stages = get_stage_defs(customer_name, NMTG_SIGNATURE, dynamic_values);
    frm._email_preview_stages = stages;

    const { to: recipient_to, cc: recipient_cc } = recipients;

    let original_cumulative_days = 0;
    let chained_reference_date = anchor_str;

	const rows = stages
		.map((stage, i) => {
			const c = STAGE_COLOR;
			const panel_id = `pstage-panel-${stage.key}`;
			const arrow_id = `pstage-arrow-${stage.key}`;

			const field_key = get_stage_field_key(stage.key);
			const already_sent = frm.doc[`custom_${field_key}_email_sent`];
			const sent_on = frm.doc[`custom_${field_key}_email_sent_on`];

			original_cumulative_days += stage.offset_days;
			const original_due_date = frappe.datetime.add_days(anchor_str, original_cumulative_days);

			const chained_due_date = frappe.datetime.add_days(chained_reference_date, stage.offset_days);

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
					onclick="event.stopPropagation(); send_prospect_stage_email_ui('${stage.key}');">
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
				${recipient_to
					? `To: <b>${frappe.utils.escape_html(recipient_to)}</b>${recipient_cc.length ? ` &nbsp;|&nbsp; CC: <b>${frappe.utils.escape_html(recipient_cc.join(", "))}</b>` : ""}`
					: `<span style="color:#c62828;">No linked Contact with an email address found</span>`}
			</div>
			${rows}
		</div>
	`);
}

// Recipients are pulled from the ORIGINATING Lead's custom_contact_info rows
// (email_id, primary_contact) via the Prospect's `leads` child table link,
// mirroring get_lead_recipients() on the Lead form exactly. If a Prospect is
// linked to more than one Lead, contacts from all linked Leads are merged.
//
// Only Leads whose workflow_state is "Qualified" are considered — contacts
// from non-Qualified linked Leads are excluded entirely.
//
// NOTE: we fetch the full Lead doc (frappe.client.get, via frappe.db.get_doc)
// rather than list-querying "Lead Contact Info" directly — child-table
// doctypes have no list-view permissions of their own, so frappe.client.get_list
// against them gets blocked and silently returns nothing. Reading the child
// rows off the parent Lead doc uses normal Lead-level read permissions instead.
function get_prospect_recipients(frm) {
	const lead_names = (frm.doc.leads || []).map(row => row.lead).filter(Boolean);
	if (!lead_names.length) return Promise.resolve({ to: null, cc: [] });

	return Promise.all(
		lead_names.map(name => frappe.db.get_doc("Lead", name).catch(() => null))
	).then(leads => {
		const rows = [];
		leads
			.filter(Boolean)
			.filter(lead => lead.workflow_state === "Qualified")
			.forEach(lead => {
				(lead.custom_contact_info || []).forEach(row => {
					if (row.email_id) rows.push(row);
				});
			});

		if (!rows.length) return { to: null, cc: [] };

		const emails = [];
		let primary_email = null;

		rows.forEach(row => {
			if (row.primary_contact && !primary_email) primary_email = row.email_id;
			if (!emails.includes(row.email_id)) emails.push(row.email_id);
		});

		const to = primary_email || emails[emails.length - 1];
		const cc = emails.filter(e => e !== to);

		return { to, cc };
	});
}

function send_prospect_stage_email_ui(stage_key) {
	const frm = cur_frm;
	if (!frm || frm.doc.doctype !== "Prospect") return;

	const stage = (frm._email_preview_stages || []).find(s => s.key === stage_key);
	if (!stage) return;

	get_prospect_recipients(frm).then(({ to, cc }) => {
		if (!to) {
			frappe.msgprint(__("No linked Contact with an email address found. Add one before sending."));
			return;
		}

		const confirm_msg = cc.length
			? __("Send \"{0}\" to {1} (cc: {2})?", [stage.label, to, cc.join(", ")])
			: __("Send \"{0}\" to {1}?", [stage.label, to]);

		frappe.confirm(
			confirm_msg,
			() => {
				frappe.call({
					method: "nmtg.override.api.send_prospect_stage_email",
					args: {
						prospect: frm.doc.name,
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
							const sent_msg = r.message.cc && r.message.cc.length
								? __("Email sent to {0} (cc: {1})", [r.message.recipient, r.message.cc.join(", ")])
								: __("Email sent to {0}", [r.message.recipient]);
							frappe.show_alert({ message: sent_msg, indicator: "green" });
							render_email_preview(frm);
						}
					}
				});
			}
		);
	});
}
window.send_prospect_stage_email_ui = send_prospect_stage_email_ui;

async function get_title_field(doctype) {
	await new Promise(resolve => frappe.model.with_doctype(doctype, resolve));
	const meta = frappe.get_meta(doctype);
	return (meta && meta.title_field) || "name";
}

async function get_link_titles(doctype, names) {
	if (!names || !names.length) return [];
	const title_field = await get_title_field(doctype);
	if (title_field === "name") return names;

	return Promise.all(
		names.map(n =>
			frappe.db.get_value(doctype, n, title_field)
				.then(r => (r.message && r.message[title_field]) || n)
				.catch(() => n)
		)
	);
}

async function get_dynamic_prospect_values(frm) {
	const industries = (frm.doc.custom_industry_ct || []).map(r => r.industry).filter(Boolean);
	const applications = (frm.doc.custom_application || []).map(r => r.application).filter(Boolean);
	const customer_types = (frm.doc.custom_customer_type || []).map(r => r.customer_type).filter(Boolean);
	const product_groups = (frm.doc.custom_product_group || []).map(r => r.product_group).filter(Boolean);

	const [industry_titles, application_titles, customer_type_titles, product_group_titles] = await Promise.all([
		get_link_titles("Industry", industries),
		get_link_titles("Application", applications),
		get_link_titles("Customer Type", customer_types),
		get_link_titles("Product Group", product_groups),
	]);

	return {
		industry: industry_titles.join(", ") || "your",
		application: application_titles.join(", ") || "your",
		product_group: product_group_titles.join(", ") || "our",
		customer_type: customer_type_titles.join(", ") || "your",
		product_group_list: product_group_titles,
	};
}