// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

const TPQI_DEFAULT_VALUE = "No"; // value given to a new cell
const TPQI_MAX_CODES = 500; // safety cap for very large ranges
const TPQI_SELECTION_FIELD = "nmtg_code_data"; // stores the codes selected in NMTG Code

frappe.ui.form.on("Third Party Quality Inspection", {
	refresh(frm) {
		tpqi_render_testing(frm, true);
	},

	nmtg_heat_number(frm) {
		tpqi_render_testing(frm, false);
	},

	testing_type(frm) {
		tpqi_render_testing(frm, false);
	},

	grn(frm) {
		frm.__tpqi_grn_cache = {};
		tpqi_render_codes(frm);
	},

	item_code(frm) {
		tpqi_render_codes(frm);
	},

	qty(frm) {
		tpqi_calculate_qty(frm, false);
	},

	validate(frm) {
		tpqi_calculate_qty(frm, false);
	},
});

frappe.ui.form.on("Testing Type CT", {
	testing_type_remove(frm) {
		tpqi_render_testing(frm, false);
	},
});

/* ---------- helpers ---------- */

function tpqi_get_saved(frm) {
	try {
		const parsed = JSON.parse(frm.doc.testing_data || "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (e) {
		return {};
	}
}

// Reads the selected values of a Table MultiSelect (array of child rows).
function tpqi_get_multiselect_values(frm, fieldname) {
	const raw = frm.doc[fieldname];
	if (!Array.isArray(raw)) {
		return raw ? [String(raw)] : [];
	}

	const skip = new Set([
		"name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
		"parent", "parentfield", "parenttype", "doctype",
	]);

	// the child doctype's Link field holds the selected value
	let link_field = null;
	const df = frm.fields_dict[fieldname] && frm.fields_dict[fieldname].df;
	if (df && df.options) {
		const meta = frappe.get_meta(df.options);
		const lf = meta && (meta.fields || []).find((f) => f.fieldtype === "Link");
		link_field = lf && lf.fieldname;
	}

	const values = [];
	raw.forEach((row) => {
		let val = link_field ? row[link_field] : null;
		if (!val) {
			for (const key of Object.keys(row)) {
				if (skip.has(key) || key.startsWith("__")) continue;
				if (typeof row[key] === "string" && row[key]) {
					val = row[key];
					break;
				}
			}
		}
		if (val && !values.includes(val)) values.push(val);
	});

	return values;
}

function tpqi_get_testing_types(frm) {
	return tpqi_get_multiselect_values(frm, "testing_type");
}

function tpqi_expand_codes(text) {
	const codes = [];
	const push = (c) => {
		if (c && !codes.includes(c) && codes.length < TPQI_MAX_CODES) codes.push(c);
	};

	String(text || "")
		.split(/[,;\n]+/)
		.map((p) => p.trim())
		.filter(Boolean)
		.forEach((part) => {
			const m = part.match(/^([A-Za-z_\/]*?)(\d+)\s*(?:-|–|—|to)\s*([A-Za-z_\/]*?)(\d+)$/i);
			if (!m) {
				push(part);
				return;
			}

			const prefix = m[1];
			const startDigits = m[2];
			const endDigits = m[4];
			const start = parseInt(startDigits, 10);

			// "NK533 - NK37" -> end shares the leading digits of start (NK537)
			const end =
				endDigits.length < startDigits.length
					? parseInt(startDigits.slice(0, startDigits.length - endDigits.length) + endDigits, 10)
					: parseInt(endDigits, 10);

			if (end < start || end - start >= TPQI_MAX_CODES) {
				// not a usable range - show both ends as plain codes
				push(prefix + startDigits);
				push(m[3] + endDigits);
				return;
			}

			const width = startDigits.startsWith("0") ? startDigits.length : 0;
			for (let n = start; n <= end; n++) {
				push(prefix + String(n).padStart(width, "0"));
			}
		});

	return codes;
}

function tpqi_style_select($sel) {
	const yes = $sel.val() === "Yes";
	$sel.css({
		background: yes ? "#1f7a4d" : "#b00000",
		color: "#fff",
	});
}

/* ---------- GRN codes (Purchase Receipt Item -> custom_nmtg_heat_number) ---------- */

// Returns (via Promise) all NMTG codes of the GRN rows that match the item code.
function tpqi_fetch_grn_codes(frm) {
	const grn = frm.doc.grn;
	const item_code = frm.doc.item_code;

	if (!grn || !item_code) return Promise.resolve([]);

	frm.__tpqi_grn_cache = frm.__tpqi_grn_cache || {};
	const key = `${grn}||${item_code}`;
	if (frm.__tpqi_grn_cache[key]) return Promise.resolve(frm.__tpqi_grn_cache[key]);

	return frappe
		.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Purchase Receipt Item",
				parent: "Purchase Receipt",
				filters: { parent: grn, item_code: item_code },
				fields: ["custom_nmtg_heat_number"],
				order_by: "idx asc",
				limit_page_length: 0,
			},
		})
		.then((r) => {
			const codes = [];
			(r.message || []).forEach((row) => {
				tpqi_expand_codes(row.custom_nmtg_heat_number).forEach((c) => {
					if (!codes.includes(c)) codes.push(c);
				});
			});
			frm.__tpqi_grn_cache[key] = codes;
			return codes;
		})
		.catch(() => []);
}

/* ---------- selected NMTG codes (stored in nmtg_code_data) ---------- */

function tpqi_get_selected_codes(frm) {
	return String(frm.doc[TPQI_SELECTION_FIELD] || "")
		.split(/[,;\n]+/)
		.map((c) => c.trim())
		.filter(Boolean);
}

// Writes the selection to nmtg_code_data (ordered like the code list). Only writes when changed.
function tpqi_save_selected_codes(frm, codes, selected) {
	const chosen = new Set(selected || []);
	const value = codes.filter((c) => chosen.has(c)).join(", ");

	const current = tpqi_get_selected_codes(frm);
	const current_value = codes.filter((c) => current.includes(c)).join(", ");

	if (value === current_value && value === String(frm.doc[TPQI_SELECTION_FIELD] || "")) return;
	if (value === current_value && !frm.doc[TPQI_SELECTION_FIELD] && !value) return;

	frm.set_value(TPQI_SELECTION_FIELD, value);
}

/* ---------- render: NMTG Code (HTML field `nmtg_code`) - MultiSelectPills ---------- */

function tpqi_render_codes(frm) {
	const field = frm.fields_dict.nmtg_code;
	if (!field || !field.$wrapper) return;

	// stop the previous observer before re-rendering
	if (frm.__tpqi_code_observer) {
		frm.__tpqi_code_observer.disconnect();
		frm.__tpqi_code_observer = null;
	}

	// guard against out-of-order async renders
	const render_id = (frm.__tpqi_render_id = (frm.__tpqi_render_id || 0) + 1);

	const esc = frappe.utils.escape_html;
	const locked = frm.doc.docstatus !== 0;
	const $wrapper = field.$wrapper;
	const saved_codes = tpqi_get_selected_codes(frm);
	const label_html = `<label class="control-label" style="display:block;">${__("Select NMTG Code")}</label>`;

	$wrapper.empty();

	// submitted / cancelled: show label + what was saved, read-only
	if (locked) {
		const pills = saved_codes.length
			? saved_codes
					.map(
						(c) =>
							`<span class="badge" style="margin:0 6px 6px 0;padding:6px 12px;border-radius:14px;background:var(--control-bg, #f4f5f6);color:var(--text-color, #333);font-weight:500;">${esc(c)}</span>`
					)
					.join("")
			: `<span class="text-muted">${__("No NMTG codes selected.")}</span>`;
		$wrapper.html(`<div style="padding:4px 0;">${label_html}${pills}</div>`);
		return;
	}

	if (!frm.doc.grn || !frm.doc.item_code) {
		$wrapper.html(
			`<div class="text-muted" style="padding:8px 0;">${__(
				"Select GRN and Item Code to see the NMTG codes."
			)}</div>`
		);
		return;
	}

	$wrapper.html(`<div class="text-muted" style="padding:8px 0;">${__("Loading NMTG codes...")}</div>`);

	tpqi_fetch_grn_codes(frm).then((codes) => {
		// a newer render started meanwhile - ignore this one
		if (render_id !== frm.__tpqi_render_id) return;

		$wrapper.empty();

		if (!codes.length) {
			$wrapper.html(
				`<div class="text-muted" style="padding:8px 0;">${__(
					"No NMTG codes found in the GRN for this item."
				)}</div>`
			);
			return;
		}

		const options = codes.map((code) => ({ value: code, label: code }));

		const control = frappe.ui.form.make_control({
			parent: $wrapper,
			df: {
				fieldtype: "MultiSelectPills",
				label: __("Select NMTG Code"),
				fieldname: "nmtg_code_select",
				options: options,
			},
			render_input: true,
		});

		// restore saved selection (only codes still present in the GRN list)
		const previous = saved_codes.filter((c) => codes.includes(c));
		if (previous.length) control.set_value(previous);

		// drop codes that are no longer in the GRN list
		tpqi_save_selected_codes(frm, codes, previous);

		const observer = new MutationObserver(function () {
			tpqi_save_selected_codes(frm, codes, control.get_value() || []);
		});

		observer.observe($wrapper[0], {
			childList: true,
			subtree: true,
		});

		frm.__tpqi_code_observer = observer;
		frm.__tpqi_code_control = control;
	});
}

/* ---------- render: Testing grid (HTML field `testing`) ---------- */

function tpqi_render_testing(frm, silent) {
	const field = frm.fields_dict.testing;
	if (!field || !field.$wrapper) {
		tpqi_render_codes(frm);
		return;
	}

	const saved = tpqi_get_saved(frm);
	const locked = frm.doc.docstatus !== 0; // read-only after submit / cancel
	const types = tpqi_get_testing_types(frm);
	const codes = tpqi_expand_codes(frm.doc.nmtg_heat_number);
	const esc = frappe.utils.escape_html;

	if (!types.length || !codes.length) {
		field.$wrapper.html(
			`<div class="text-muted" style="padding:8px 0;">${__(
				"Select Testing Type and enter NMTG Heat Number range to fill the testing grid."
			)}</div>`
		);
		if (!locked) tpqi_sync_testing_data(frm, field.$wrapper, silent);
		tpqi_render_codes(frm);
		return;
	}

	const head = codes.map((c) => `<th class="text-center">${esc(c)}</th>`).join("");

	const body = types
		.map((type) => {
			const cells = codes
				.map((code) => {
					const val = (saved[type] && saved[type][code]) || TPQI_DEFAULT_VALUE;
					const bg = val === "Yes" ? "#1f7a4d" : "#b00000";
					return `
						<td class="text-center">
							<select class="tpqi-select" data-type="${esc(type)}" data-code="${esc(code)}"
								style="background:${bg};color:#fff;border:0;border-radius:14px;padding:2px 10px;min-width:80px;"
								${locked ? "disabled" : ""}>
								<option value="Yes" ${val === "Yes" ? "selected" : ""}>Yes</option>
								<option value="No" ${val === "No" ? "selected" : ""}>No</option>
							</select>
						</td>`;
				})
				.join("");
			return `<tr><td style="vertical-align:middle;">${esc(type)}</td>${cells}</tr>`;
		})
		.join("");

	field.$wrapper.html(`
		<div class="tpqi-testing" style="overflow-x:auto;">
			<table class="table table-bordered" style="margin-bottom:0;">
				<thead>
					<tr><th>${__("Testing Type")}</th>${head}</tr>
				</thead>
				<tbody>${body}</tbody>
			</table>
		</div>
	`);

	if (!locked) {
		tpqi_sync_testing_data(frm, field.$wrapper, silent);

		field.$wrapper.find("select.tpqi-select").on("change", function () {
			tpqi_style_select($(this));
			tpqi_sync_testing_data(frm, field.$wrapper, false);
		});
	}

	tpqi_render_codes(frm);
}

/* ---------- store ---------- */

function tpqi_sync_testing_data(frm, $wrapper, silent) {
	const data = {};
	$wrapper.find("select.tpqi-select").each(function () {
		const type = $(this).attr("data-type");
		const code = $(this).attr("data-code");
		(data[type] = data[type] || {})[code] = $(this).val();
	});

	const json = Object.keys(data).length ? JSON.stringify(data) : "";

	if (json !== (frm.doc.testing_data || "")) {
		if (silent && !frm.is_new()) {
			// opening an existing doc: keep field in sync without marking the form dirty
			frm.doc.testing_data = json;
		} else {
			frm.set_value("testing_data", json);
		}
	}

	tpqi_calculate_qty(frm, silent);
}

function tpqi_calculate_qty(frm, silent) {
	if (frm.doc.docstatus !== 0) return;

	const data = tpqi_get_saved(frm);
	const types = tpqi_get_testing_types(frm);

	const codes = [];
	types.forEach((t) => {
		Object.keys(data[t] || {}).forEach((c) => {
			if (!codes.includes(c)) codes.push(c);
		});
	});

	let accepted = 0;
	let rejected = 0;

	if (codes.length && types.length) {
		const qty = flt(frm.doc.qty);
		const qty_per_code = qty / codes.length;

		const accepted_codes = codes.filter((c) =>
			types.every((t) => String((data[t] || {})[c] || "").trim().toLowerCase() === "yes")
		);

		accepted = flt(qty_per_code * accepted_codes.length, 3);
		rejected = flt(qty - accepted, 3);
	}

	if (flt(frm.doc.accepted_qty) === accepted && flt(frm.doc.rejected_qty) === rejected) return;

	if (silent && !frm.is_new()) {
		// opening an existing doc: refresh values without marking the form dirty
		frm.doc.accepted_qty = accepted;
		frm.doc.rejected_qty = rejected;
		frm.refresh_field("accepted_qty");
		frm.refresh_field("rejected_qty");
	} else {
		frm.set_value("accepted_qty", accepted);
		frm.set_value("rejected_qty", rejected);
	}
}