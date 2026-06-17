
frappe.ui.form.on("Quality Inspection Reading", {
    form_render(frm, cdt, cdn) {
        render_custom_reading_html(frm, cdt, cdn);
    }
});

frappe.ui.form.on("Quality Inspection", {

    refresh(frm) {
        frm.fields_dict["custom_add_reading"].$input
            && frm.fields_dict["custom_add_reading"].$input
                .addClass("btn-primary");
    },

    custom_add_reading(frm) {

        const rawRange = (frm.doc.custom_nmtg_heat_number || "").trim();
        if (!rawRange) {
            frappe.msgprint({
                title: __("Missing Heat Number"),
                message: __("Please fill <b>NMTG Heat Number</b> before adding readings."),
                indicator: "orange"
            });
            return;
        }

        const heatNumbers = parse_heat_range(rawRange);
        if (!heatNumbers) {
            frappe.msgprint({
                title: __("Invalid Format"),
                message: __("NMTG Heat Number must be in the format <b>NK132 - NK181</b>."),
                indicator: "red"
            });
            return;
        }

        const readings = frm.doc.readings || [];
        const params   = collect_params(readings);
        const existing = build_existing_map(readings, params);

        open_reading_dialog(frm, heatNumbers, params, existing);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse "NK132 - NK181"  →  ["NK132","NK133",…,"NK181"]
// ─────────────────────────────────────────────────────────────────────────────
function parse_heat_range(raw) {
    const parts = raw.split(/\s*[-–—]\s*/);
    if (parts.length !== 2) return null;

    const re = /^([A-Za-z]*)(\d+)$/;
    const m1 = parts[0].trim().match(re);
    const m2 = parts[1].trim().match(re);
    if (!m1 || !m2) return null;

    const prefix = m1[1];
    const start  = parseInt(m1[2]);
    const end    = parseInt(m2[2]);

    if (isNaN(start) || isNaN(end) || end < start) return null;
    if (end - start > 500) {
        frappe.msgprint(__("Range too large (max 500 rows)."));
        return null;
    }

    const list = [];
    const pad  = m1[2].length;
    for (let i = start; i <= end; i++) {
        list.push(prefix + String(i).padStart(pad, "0"));
    }
    return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collect unique parameters from child rows, in order of first appearance
// ─────────────────────────────────────────────────────────────────────────────
function collect_params(readings) {
    const seen   = new Set();
    const result = [];
    for (const r of readings) {
        const s = (r.specification || "").trim();
        if (s && !seen.has(s)) {
            seen.add(s);
            result.push({
                spec              : s,
                label             : s,
                numeric           : r.numeric,
                min_value         : r.min_value,
                max_value         : r.max_value,
                manual_inspection : r.manual_inspection
            });
        }
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build  { spec → { heatNo → value } }  from existing readings rows
// ─────────────────────────────────────────────────────────────────────────────
function build_existing_map(readings, params) {
    const map = {};
    for (const p of params) {
        map[p.spec] = {};
    }
    for (const r of readings) {
        const spec = (r.specification || "").trim();
        if (!spec) continue;
        if (!map[spec]) map[spec] = {};
        let details = {};
        try { details = JSON.parse(r.custom_reading_details || "{}"); } catch (e) {}
        Object.assign(map[spec], details);
    }
    return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check if a single value passes min/max for a param
// Returns: true = pass, false = fail, null = not applicable
//
// If the parameter row has "Manual Inspection" checked, any non-empty value
// is treated as accepted — min/max criteria are bypassed entirely.
// ─────────────────────────────────────────────────────────────────────────────
function check_value_status(val, param_meta) {
    if (!param_meta) return null;
    if (val === undefined || val === null || val === "") return null;

    if (param_meta.manual_inspection) {
        return true;
    }

    if (!param_meta.numeric) return null;
    const min = parseFloat(param_meta.min_value);
    const max = parseFloat(param_meta.max_value);
    if (isNaN(min) || isNaN(max) || (min === 0 && max === 0)) return null;
    const num = parseFloat(val);
    if (isNaN(num)) return false;
    return num >= min && num <= max;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build heat-number → overall status map across all params
// (used for the per-heat-number "Overall" column in the dialog — binary)
// ─────────────────────────────────────────────────────────────────────────────
function build_hn_status_map(heatNumbers, params, draft) {
    const map = {};
    for (const hn of heatNumbers) {
        let anyApplicable = false;
        let anyFail       = false;
        for (const p of params) {
            const val = (draft[p.spec] || {})[hn];
            if (val === undefined || val === "") continue;
            const result = check_value_status(val, p);
            if (result === null) continue;
            anyApplicable = true;
            if (!result) anyFail = true;
        }
        map[hn] = !anyApplicable ? "na" : anyFail ? "rejected" : "accepted";
    }
    return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute the 3-way overall status for a single parameter row, across all
// heat numbers entered for it:
//   - all entered values accepted  → "Accepted"
//   - all entered values rejected  → "Rejected"
//   - a mix of accepted & rejected → "Partially Accepted"
//   - no applicable values entered → null (leave status untouched)
// ─────────────────────────────────────────────────────────────────────────────
function compute_row_overall_status(param_meta, heatNumbers, draftForSpec) {
    let countAccepted = 0;
    let countRejected = 0;

    for (const hn of heatNumbers) {
        const val = (draftForSpec || {})[hn];
        if (val === undefined || val === "") continue;
        const result = check_value_status(val, param_meta);
        if (result === null) continue;
        if (result) countAccepted++; else countRejected++;
    }

    if (countAccepted === 0 && countRejected === 0) return null;
    if (countRejected === 0) return "Accepted";
    if (countAccepted === 0) return "Rejected";
    return "Partially Accepted";
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY paginated preview table inside child table row (custom_reading)
// Shows per-heat-number Accepted / Rejected status
// ─────────────────────────────────────────────────────────────────────────────
const READING_PAGE_SIZE = 10;
function render_paginated_reading_table($container, entries, page, param_meta, allHeatNumbers = []) {
    page = page || 1;

    const detailMap = {};
    entries.forEach(([hn, val]) => {
        detailMap[hn] = val;
    });

    let accepted_count = 0;
    let rejected_count = 0;

    entries.forEach(([hn, val]) => {
        const result = param_meta ? check_value_status(val, param_meta) : null;

        if (result === true) {
            accepted_count++;
        } else if (result === false) {
            rejected_count++;
        }
    });

    const total_heat_count = allHeatNumbers.length || entries.length;
    const entered_count = entries.length;
    const not_added_count = total_heat_count - entered_count;

    const totalPages = Math.max(1, Math.ceil(entries.length / READING_PAGE_SIZE));
    page = Math.min(Math.max(page, 1), totalPages);

    const start = (page - 1) * READING_PAGE_SIZE;
    const pageEntries = entries.slice(start, start + READING_PAGE_SIZE);

    const rows = pageEntries.map(([hn, val]) => {
        const result = param_meta ? check_value_status(val, param_meta) : null;

        const statusBadge = result === true
            ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:#d4edda;color:#155724;">✓ Accepted</span>`
            : result === false
            ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:#f8d7da;color:#721c24;">✗ Rejected</span>`
            : `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:#e9ecef;color:#6c757d;">— N/A</span>`;

        return `
            <tr>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;">${hn}</td>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;">${val}</td>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;text-align:center;">${statusBadge}</td>
            </tr>`;
    }).join("");

    $container.html(`
        <table style="width:100%;border-collapse:collapse;">
            <thead>
                <tr>
                    <th>Heat No</th>
                    <th>Value</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>

        <div style="margin-top:10px;display:flex;gap:12px;">
            <span style="padding:4px 10px;background:#d4edda;border-radius:12px;">
                ✓ Accepted: ${accepted_count}
            </span>

            <span style="padding:4px 10px;background:#f8d7da;border-radius:12px;">
                ✗ Rejected: ${rejected_count}
            </span>

            <span style="padding:4px 10px;background:#e9ecef;border-radius:12px;">
                — Not Added: ${not_added_count}
            </span>
        </div>
    `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render custom_reading HTML inside an expanded child table row
// ─────────────────────────────────────────────────────────────────────────────
function render_custom_reading_html(frm, cdt, cdn) {
    const grid_row = frm.fields_dict["readings"].grid.grid_rows_by_docname[cdn];
    if (!grid_row || !grid_row.grid_form) return;

    const wrapper = grid_row.grid_form.fields_dict["custom_reading"];
    if (!wrapper) return;

    const d = locals[cdt][cdn];
    let details = {};
    try { details = JSON.parse(d.custom_reading_details || "{}"); } catch (e) {}

    const param_meta = {
        numeric           : d.numeric,
        min_value         : d.min_value,
        max_value         : d.max_value,
        manual_inspection : d.manual_inspection
    };

    // render_paginated_reading_table($(wrapper.wrapper), Object.entries(details), 1, param_meta);

    const rawRange = (frm.doc.custom_nmtg_heat_number || "").trim();
    const heatNumbers = parse_heat_range(rawRange) || [];

    render_paginated_reading_table(
        $(wrapper.wrapper),
        Object.entries(details),
        1,
        param_meta,
        heatNumbers
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Build & open the main dialog
// ─────────────────────────────────────────────────────────────────────────────
function open_reading_dialog(frm, heatNumbers, params, existing) {

    const noParams   = params.length === 0;
    const PAGE_SIZE  = 10;
    const totalPages = Math.max(1, Math.ceil(heatNumbers.length / PAGE_SIZE));
    let currentPage  = 1;

    const draft = {};
    params.forEach(p => {
        draft[p.spec] = Object.assign({}, existing[p.spec] || {});
    });

    function rawRange() {
        return (frm.doc.custom_nmtg_heat_number || "").trim();
    }

    function get_page_slice(page) {
        const start = (page - 1) * PAGE_SIZE;
        return heatNumbers.slice(start, start + PAGE_SIZE);
    }

    function capture_visible_inputs() {
        dialog.$wrapper.find(".qir-input").each(function () {
            const hn   = $(this).data("hn");
            const spec = $(this).data("spec");
            const val  = $(this).val().trim();
            if (!draft[spec]) draft[spec] = {};
            if (val) {
                draft[spec][hn] = val;
            } else {
                delete draft[spec][hn];
            }
        });
    }

    function build_pager_html() {
        if (totalPages <= 1) return "";
        const start = (currentPage - 1) * PAGE_SIZE;
        const end   = Math.min(currentPage * PAGE_SIZE, heatNumbers.length);

        let options = "";
        for (let p = 1; p <= totalPages; p++) {
            options += `<option value="${p}" ${p === currentPage ? "selected" : ""}>${p}</option>`;
        }

        return `
            <div class="qir-pager">
                <button type="button" class="qir-page-nav" data-page="${currentPage - 1}"
                    ${currentPage === 1 ? "disabled" : ""}>‹ Prev</button>
                <span class="qir-page-info">
                    Page <select class="qir-page-select">${options}</select> of ${totalPages}
                    &nbsp;·&nbsp; showing rows ${start + 1}–${end} of ${heatNumbers.length}
                </span>
                <button type="button" class="qir-page-nav" data-page="${currentPage + 1}"
                    ${currentPage === totalPages ? "disabled" : ""}>Next ›</button>
            </div>`;
    }

    function build_table_html() {
        const pageHeatNumbers = get_page_slice(currentPage);
        const hnStatusMap     = build_hn_status_map(heatNumbers, params, draft);

        // ── Per-column (param) overall status — 3-way: Accepted / Rejected / Partially Accepted ──
        const paramStatus = {};
        if (!noParams) {
            for (const p of params) {
                paramStatus[p.spec] = compute_row_overall_status(p, heatNumbers, draft[p.spec]);
            }
        }

        // ── Header ───────────────────────────────────────────────────────
        let headerCells = `<th class="qir-th qir-th--hn">NMTG Heat No</th>`;
        headerCells    += `<th class="qir-th qir-th--status">Overall</th>`;

        if (noParams) {
            headerCells += `<th class="qir-th" style="color:#999;">No parameters found in Readings table</th>`;
        } else {
            for (const p of params) {
                const st = paramStatus[p.spec];
                const badge = st === "Accepted"
                    ? `<span class="qir-badge qir-badge--pass">✓ Pass</span>`
                    : st === "Rejected"
                    ? `<span class="qir-badge qir-badge--fail">✗ Fail</span>`
                    : st === "Partially Accepted"
                    ? `<span class="qir-badge qir-badge--partial">◐ Partial</span>`
                    : ``;

                const hasRange = p.numeric && !p.manual_inspection
                    && !(parseFloat(p.min_value) === 0 && parseFloat(p.max_value) === 0);
                const rangeHint = hasRange
                    ? `<span class="qir-range-hint">${p.min_value} – ${p.max_value}</span>`
                    : ``;

                headerCells += `<th class="qir-th">
                                    ${frappe.utils.escape_html(p.label)}
                                    ${rangeHint}
                                    ${badge}
                                </th>`;
            }
        }

        // ── Body rows ─────────────────────────────────────────────────────
        let bodyRows = "";
        for (const hn of pageHeatNumbers) {
            const hnSt = hnStatusMap[hn];
            const hnBadge = hnSt === "accepted"
                ? `<span class="qir-badge qir-badge--pass">✓ Accepted</span>`
                : hnSt === "rejected"
                ? `<span class="qir-badge qir-badge--fail">✗ Rejected</span>`
                : `<span class="qir-badge qir-badge--na">— N/A</span>`;

            let cells = `<td class="qir-td qir-td--hn">${frappe.utils.escape_html(hn)}</td>`;
            cells     += `<td class="qir-td qir-td--status">${hnBadge}</td>`;

            if (noParams) {
                cells += `<td class="qir-td"></td>`;
            } else {
                for (const p of params) {
                    const val    = (draft[p.spec] || {})[hn] || "";
                    const result = val !== "" ? check_value_status(val, p) : null;
                    const cellCls = result === true  ? "qir-td qir-td--cell-pass"
                                  : result === false ? "qir-td qir-td--cell-fail"
                                  : "qir-td";
                    cells += `<td class="${cellCls}">
                                  <input
                                      class="qir-input"
                                      data-hn="${frappe.utils.escape_html(hn)}"
                                      data-spec="${frappe.utils.escape_html(p.spec)}"
                                      type="text"
                                      value="${frappe.utils.escape_html(String(val))}"
                                      autocomplete="off"
                                  />
                              </td>`;
                }
            }
            bodyRows += `<tr class="qir-row">${cells}</tr>`;
        }

        return `
        <style>
            .qir-wrapper {
                overflow: auto;
                border: 1px solid var(--border-color, #d1d8dd);
                border-radius: 8px;
            }
            .qir-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 15px;
                font-family: var(--font-stack, sans-serif);
                min-width: max-content;
            }
            .qir-th {
                position: sticky;
                top: 0;
                z-index: 2;
                background: #f0f4f7;
                border: 1px solid #d1d8dd;
                padding: 10px 16px;
                text-align: left;
                white-space: nowrap;
                font-weight: 600;
                color: var(--text-muted, #6c757d);
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: .04em;
            }
            .qir-th--hn {
                position: sticky;
                left: 0;
                z-index: 3;
                background: #e8edf2;
                min-width: 160px;
            }
            .qir-th--status {
                position: sticky;
                left: 160px;
                z-index: 3;
                background: #e8edf2;
                min-width: 130px;
                text-align: center;
            }
            .qir-td {
                border: 1px solid #e4e9ef;
                padding: 6px 8px;
                vertical-align: middle;
                background: #fff;
            }
            .qir-td--hn {
                position: sticky;
                left: 0;
                z-index: 1;
                background: #f7f9fb;
                font-weight: 600;
                font-size: 14px;
                color: var(--text-color, #1f272e);
                padding: 10px 16px;
                white-space: nowrap;
                border: 1px solid #e4e9ef;
            }
            .qir-td--status {
                position: sticky;
                left: 160px;
                z-index: 1;
                background: #f7f9fb;
                text-align: center;
                white-space: nowrap;
                border: 1px solid #e4e9ef;
            }
            .qir-td--cell-pass {
                border: 1px solid #e4e9ef;
                padding: 6px 8px;
                vertical-align: middle;
                background: #f0faf3;
            }
            .qir-td--cell-fail {
                border: 1px solid #e4e9ef;
                padding: 6px 8px;
                vertical-align: middle;
                background: #fff5f5;
            }
            .qir-row:hover .qir-td,
            .qir-row:hover .qir-td--cell-pass,
            .qir-row:hover .qir-td--cell-fail { filter: brightness(.97); }
            .qir-badge {
                display: inline-block;
                padding: 2px 9px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .03em;
                vertical-align: middle;
            }
            .qir-badge--pass {
                background: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }
            .qir-badge--fail {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }
            .qir-badge--partial {
                background: #fff3cd;
                color: #856404;
                border: 1px solid #ffeeba;
            }
            .qir-badge--na {
                background: #e9ecef;
                color: #6c757d;
                border: 1px solid #dee2e6;
            }
            .qir-range-hint {
                display: block;
                font-size: 10px;
                font-weight: 400;
                color: #999;
                text-transform: none;
                letter-spacing: 0;
                margin-top: 2px;
            }
            .qir-input {
                width: 100%;
                min-width: 100px;
                border: 1px solid transparent;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 14px;
                background: transparent;
                transition: border-color .15s, background .15s;
                box-sizing: border-box;
            }
            .qir-input:focus {
                outline: none;
                border-color: var(--primary, #2490ef);
                background: #fff;
                box-shadow: 0 0 0 2px rgba(36,144,239,.15);
            }
            .qir-meta {
                font-size: 12px;
                color: var(--text-muted, #6c757d);
                margin-bottom: 10px;
            }
            .qir-meta b { color: var(--text-color, #1f272e); }
            .qir-pager {
                display: flex;
                align-items: center;
                gap: 14px;
                margin-top: 12px;
                font-size: 13px;
            }
            .qir-page-nav {
                padding: 5px 14px;
                border: 1px solid var(--border-color, #d1d8dd);
                border-radius: 6px;
                background: #fff;
                cursor: pointer;
            }
            .qir-page-nav:disabled { opacity: .4; cursor: not-allowed; }
            .qir-page-nav:not(:disabled):hover {
                background: #f5faff;
                border-color: var(--primary, #2490ef);
            }
            .qir-page-info { color: var(--text-muted, #6c757d); }
            .qir-page-select {
                margin: 0 4px;
                padding: 3px 6px;
                border-radius: 4px;
                border: 1px solid var(--border-color, #d1d8dd);
            }
        </style>

        <p class="qir-meta">
            Range: <b>${frappe.utils.escape_html(rawRange())}</b>
            &nbsp;·&nbsp;
            <b>${heatNumbers.length}</b> heat numbers
            &nbsp;·&nbsp;
            <b>${params.length}</b> parameter${params.length !== 1 ? "s" : ""}
        </p>

        <div class="qir-wrapper">
            <table class="qir-table" id="qir-table">
                <thead><tr>${headerCells}</tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>

        ${build_pager_html()}
        `;
    }

    function go_to_page(page) {
        page = Math.min(Math.max(page, 1), totalPages);
        if (page === currentPage) return;
        capture_visible_inputs();
        currentPage = page;
        render();
    }

    function render() {
        dialog.fields_dict.reading_table_html.$wrapper.html(build_table_html());
        bind_events();
    }

    function bind_events() {
        dialog.$wrapper.find(".qir-page-nav").off("click").on("click", function () {
            if ($(this).is(":disabled")) return;
            go_to_page(parseInt($(this).data("page")));
        });
        dialog.$wrapper.find(".qir-page-select").off("change").on("change", function () {
            go_to_page(parseInt($(this).val()));
        });
    }

    const dialog = new frappe.ui.Dialog({
        title   : __("Add / Edit Readings — NMTG Heat Numbers"),
        size    : "extra-large",
        fields  : [
            {
                fieldtype : "HTML",
                fieldname : "reading_table_html",
                options   : build_table_html()
            }
        ],
        primary_action_label: __("Save Readings"),
        primary_action() {
            capture_visible_inputs();
            save_readings(frm, params, heatNumbers, draft, dialog);
        }
    });

    dialog.show();
    bind_events();

    dialog.$wrapper.on("keydown", ".qir-input", function (e) {
        const inputs = dialog.$wrapper.find(".qir-input").toArray();
        const idx    = inputs.indexOf(this);
        const cols   = params.length || 1;

        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
            e.preventDefault();
            const next = e.key === "Enter" ? inputs[idx + cols] : inputs[idx + 1];
            if (next) {
                next.focus(); next.select();
            } else if (e.key === "Enter" && currentPage < totalPages) {
                go_to_page(currentPage + 1);
                setTimeout(() => {
                    const first = dialog.$wrapper.find(".qir-input").get(0);
                    if (first) { first.focus(); first.select(); }
                }, 0);
            }
        } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            const prev = inputs[idx - 1];
            if (prev) { prev.focus(); prev.select(); }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Save readings back to child table rows and persist to DB
//
// For each parameter row, also computes and sets the row's "status" field:
//   - all entered heat-number values accepted  → "Accepted"
//   - all entered heat-number values rejected  → "Rejected"
//   - a mix of accepted and rejected            → "Partially Accepted"
// Rows with manual_inspection checked treat any non-empty value as accepted.
// If no applicable values were entered for a row, its status is left as-is.
// ─────────────────────────────────────────────────────────────────────────────
function save_readings(frm, params, heatNumbers, draft, dialog) {
    if (!params.length) {
        dialog.hide();
        return;
    }

    const set_value_promises = [];
    const params_by_spec = {};
    params.forEach(p => { params_by_spec[p.spec] = p; });

    (frm.doc.readings || []).forEach(row => {
        const spec = row.specification;
        if (!draft[spec]) return;

        set_value_promises.push(
            frappe.model.set_value(
                row.doctype,
                row.name,
                "custom_reading_details",
                JSON.stringify(draft[spec])
            )
        );

        const param_meta = params_by_spec[spec];
        const rowStatus  = param_meta
            ? compute_row_overall_status(param_meta, heatNumbers, draft[spec])
            : null;

        if (rowStatus) {
            set_value_promises.push(
                frappe.model.set_value(row.doctype, row.name, "status", rowStatus)
            );
        }
    });

    Promise.all(set_value_promises).then(() => {
        update_parent_status(frm);
        frm.refresh_field("readings");

        setTimeout(() => {
            const grid = frm.fields_dict.readings.grid;
            (frm.doc.readings || []).forEach(row => {
                const grid_row = grid.grid_rows_by_docname[row.name];
                if (grid_row && grid_row.grid_form) {
                    render_custom_reading_html(frm, row.doctype, row.name);
                }
            });
        }, 300);

        dialog.hide();

        frm.save(null, function () {
            frappe.show_alert({
                message: __("Readings saved"),
                indicator: "green"
            });
        });
    });
}

function update_parent_status(frm) {
    const statuses = (frm.doc.readings || [])
        .map(r => (r.status || "").trim())
        .filter(s => s);

    if (!statuses.length) return;

    let parent_status = "";

    const allAccepted = statuses.every(s => s === "Accepted");
    const allRejected = statuses.every(s => s === "Rejected");

    if (allAccepted) {
        parent_status = "Accepted";
    } else if (allRejected) {
        parent_status = "Rejected";
    } else {
        parent_status = "Partially Accepted";
    }

    frm.set_value("status", parent_status);
}