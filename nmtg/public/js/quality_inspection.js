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

        // Extract remarks from any reading row's custom_reading_details["__remarks__"]
        let existingRemarks = {};
        for (const r of readings) {
            let details = {};
            try { details = JSON.parse(r.custom_reading_details || "{}"); } catch (e) {}
            if (details["__remarks__"] && typeof details["__remarks__"] === "object") {
                existingRemarks = details["__remarks__"];
                break;
            }
        }

        open_reading_dialog(frm, heatNumbers, params, existing, existingRemarks);
    },

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
                spec                               : s,
                label                              : s,
                numeric                            : r.numeric,
                min_value                          : r.min_value,
                max_value                          : r.max_value,
                manual_inspection                  : r.manual_inspection,
                custom_calculate_weight_per_piece_kg: r.custom_calculate_weight_per_piece_kg
            });
        }
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build  { spec → { heatNo → value } }  from existing readings rows
// Strips the reserved "__remarks__" key so it never leaks into value maps
// ─────────────────────────────────────────────────────────────────────────────
function build_existing_map(readings, params) {
    const existing = {};
    for (const p of params) {
        existing[p.spec] = {};
    }
    for (const r of readings) {
        const spec = (r.specification || "").trim();
        if (!spec) continue;
        if (!existing[spec]) existing[spec] = {};
        let details = {};
        try { details = JSON.parse(r.custom_reading_details || "{}"); } catch (e) {}
        const { __remarks__, ...values } = details;
        Object.assign(existing[spec], values);
    }
    return existing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse variable tokens like "Diameter(mm)", "Length(mm)" from a formula string
// ─────────────────────────────────────────────────────────────────────────────
function parse_formula_variables(formula) {
    const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_ ]*\([^)]*\)/g;
    return [...new Set(formula.match(TOKEN_RE) || [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluate custom_formula_for_conversion dynamically
// ─────────────────────────────────────────────────────────────────────────────
function evaluate_formula(formula, item_field_map, param_value_map) {
    if (!formula) return null;

    const tokens = parse_formula_variables(formula);
    let expr = formula;

    for (const token of tokens) {
        let val = null;

        if (token in item_field_map) {
            val = flt(item_field_map[token]);
        } else if (token in param_value_map) {
            const raw = param_value_map[token];
            if (raw === undefined || raw === null || raw === "") return null;
            val = flt(raw);
        } else {
            console.warn("[evaluate_formula] Unknown token:", token, "| formula:", formula,
                         "| item_field_map keys:", Object.keys(item_field_map),
                         "| param_value_map keys:", Object.keys(param_value_map));
            return null;
        }

        if (isNaN(val)) {
            console.warn("[evaluate_formula] NaN for token:", token, "val:", val);
            return null;
        }

        expr = expr.split(token).join(String(val));
    }

    try {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (!isFinite(result)) {
            console.warn("[evaluate_formula] Non-finite result:", result, "expr:", expr);
            return null;
        }
        return result;
    } catch (e) {
        console.error("[evaluate_formula] Eval error:", e, "expr:", expr);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build item_field_map from item_doc
// ─────────────────────────────────────────────────────────────────────────────
function build_item_field_map(item_doc) {
    return {
        "Diameter(mm)" : flt(item_doc.custom_diameter),
        "OD(mm)"       : flt(item_doc.custom_od),
        "ID(mm)"       : flt(item_doc.custom_id),
        "TL(mm)"       : flt(item_doc.custom_tl),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build param_value_map for a single heat number
// ─────────────────────────────────────────────────────────────────────────────
function build_param_value_map(params, draft, hn) {
    const map = {};
    for (const p of params) {
        const specDraft = draft[p.spec];
        if (!specDraft) continue;
        const val = specDraft[hn];
        if (val !== undefined && val !== null && val !== "") {
            map[p.spec] = val;
        }
    }
    return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check if a single value passes min/max for a param
// Returns: true = pass, false = fail, null = not applicable
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
// Returns: "accepted" | "rejected" | "na"
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
// Compute the 3-way overall status for a single parameter row
// ─────────────────────────────────────────────────────────────────────────────
function compute_row_overall_status(param_meta, heatNumbers, draftForSpec) {
    let countAccepted = 0;
    let countRejected = 0;

    const values = Object.entries(draftForSpec || {}).filter(
        ([key, val]) => key !== "__remarks__" && val !== "" && val !== null && val !== undefined
    );

    for (const [hn, val] of values) {
        const result = check_value_status(val, param_meta);
        if (result === true)  countAccepted++;
        else if (result === false) countRejected++;
    }

    if (values.length === 0) return null;

    if (countRejected === 0 && countAccepted === values.length) return "Accepted";
    if (countAccepted === 0 && countRejected > 0) return "Rejected";
    return "Partially Accepted";
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY paginated preview table inside child table row
// ─────────────────────────────────────────────────────────────────────────────
function render_paginated_reading_table(
    $container,
    entries,
    page,
    param_meta,
    allHeatNumbers,
    remarks,
    formula,
    item_field_map,
    params,
    draft
) {
    page    = page    || 1;
    remarks = remarks || {};

    const PAGE_SIZE = 10;

    let accepted_count = 0;
    let rejected_count = 0;

    entries.forEach(([hn, val]) => {
        const result = param_meta ? check_value_status(val, param_meta) : null;
        if (result === true)  accepted_count++;
        else if (result === false) rejected_count++;
    });

    const total_heat_count = (allHeatNumbers || []).length || entries.length;
    const not_added_count  = total_heat_count - entries.length;
    const totalPages       = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 1), totalPages);

    const pageEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const rows = pageEntries.map(([hn, val]) => {
        const result = param_meta ? check_value_status(val, param_meta) : null;
        const remark = remarks[hn] || "";

        let weight = "";
        if (param_meta.custom_calculate_weight_per_piece_kg && formula) {
            const param_value_map = build_param_value_map(params || [], draft || {}, hn);
            const w = evaluate_formula(formula, item_field_map || {}, param_value_map);
            weight = w !== null ? w.toFixed(3) : "0.000";
        }

        const statusBadge =
            result === true
                ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:#d4edda;color:#155724;">✓ Accepted</span>`
                : result === false
                ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:#f8d7da;color:#721c24;">✗ Rejected</span>`
                : `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:#e9ecef;color:#6c757d;">— N/A</span>`;

        return `
            <tr>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;">${frappe.utils.escape_html(hn)}</td>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;">${frappe.utils.escape_html(String(val))}</td>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;">${frappe.utils.escape_html(remark)}</td>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;text-align:center;">${statusBadge}</td>
                <td style="border:1px solid #d1d8dd;padding:7px 12px;">${weight}</td>
            </tr>`;
    }).join("");

    let pagination_html = "";
    if (totalPages > 1) {
        pagination_html = `
            <div style="margin-top:10px;display:flex;justify-content:center;gap:8px;">
                <button class="btn btn-default prev-page" ${page === 1 ? "disabled" : ""}>Prev</button>
                <span style="padding:6px 12px;">Page ${page} of ${totalPages}</span>
                <button class="btn btn-default next-page" ${page === totalPages ? "disabled" : ""}>Next</button>
            </div>`;
    }

    $container.html(`
        <table style="width:100%;border-collapse:collapse;">
            <thead>
                <tr>
                    <th style="border:1px solid #d1d8dd;padding:7px 12px;background:#f0f4f7;">Heat No</th>
                    <th style="border:1px solid #d1d8dd;padding:7px 12px;background:#f0f4f7;">Value</th>
                    <th style="border:1px solid #d1d8dd;padding:7px 12px;background:#f7f3ff;">Remark</th>
                    <th style="border:1px solid #d1d8dd;padding:7px 12px;background:#f0f4f7;">Status</th>
                    <th style="border:1px solid #d1d8dd;padding:7px 12px;background:#f0f4f7;">Weight (Kg)</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>

        <div style="margin-top:10px;display:flex;gap:12px;">
            <span style="padding:4px 10px;background:#d4edda;border-radius:12px;">✓ Accepted: ${accepted_count}</span>
            <span style="padding:4px 10px;background:#f8d7da;border-radius:12px;">✗ Rejected: ${rejected_count}</span>
            <span style="padding:4px 10px;background:#e9ecef;border-radius:12px;">— Not Added: ${not_added_count}</span>
        </div>

        ${pagination_html}
    `);

    $container.find(".prev-page").on("click", function () {
        render_paginated_reading_table(
            $container, entries, page - 1, param_meta,
            allHeatNumbers, remarks, formula, item_field_map, params, draft
        );
    });
    $container.find(".next-page").on("click", function () {
        render_paginated_reading_table(
            $container, entries, page + 1, param_meta,
            allHeatNumbers, remarks, formula, item_field_map, params, draft
        );
    });
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

    const remarks = details["__remarks__"] || {};
    const { __remarks__, ...valueDetails } = details;

    frappe.db.get_doc("Item", frm.doc.item_code).then(item_doc => {
        const formula        = item_doc.custom_formula_for_conversion || "";
        const item_field_map = build_item_field_map(item_doc);

        const param_meta = {
            numeric                              : d.numeric,
            min_value                            : d.min_value,
            max_value                            : d.max_value,
            manual_inspection                    : d.manual_inspection,
            custom_calculate_weight_per_piece_kg : d.custom_calculate_weight_per_piece_kg
        };

        const rawRange    = (frm.doc.custom_nmtg_heat_number || "").trim();
        const heatNumbers = parse_heat_range(rawRange) || [];

        // Rebuild params + draft from ALL readings so cross-param formula
        // tokens (e.g. "Thickness(mm)" used in weight formula) always resolve
        const allReadings = frm.doc.readings || [];
        const params      = collect_params(allReadings);
        const draft       = build_existing_map(allReadings, params);

        console.log("[render_custom_reading_html] formula:", formula);
        console.log("[render_custom_reading_html] item_field_map:", item_field_map);
        console.log("[render_custom_reading_html] params:", params.map(p => p.spec));
        console.log("[render_custom_reading_html] draft:", JSON.stringify(draft));

        render_paginated_reading_table(
            $(wrapper.wrapper),
            Object.entries(valueDetails),
            1,
            param_meta,
            heatNumbers,
            remarks,
            formula,
            item_field_map,
            params,
            draft
        );
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Build & open the main dialog
// ─────────────────────────────────────────────────────────────────────────────
function open_reading_dialog(frm, heatNumbers, params, existing, existingRemarks) {

    const noParams   = params.length === 0;
    const PAGE_SIZE  = 10;
    const totalPages = Math.max(1, Math.ceil(heatNumbers.length / PAGE_SIZE));
    let currentPage  = 1;

    // draft[spec][hn] = value
    const draft = {};
    params.forEach(p => {
        draft[p.spec] = Object.assign({}, existing[p.spec] || {});
    });

    // remarkDraft[hn] = remark string
    const remarkDraft = Object.assign({}, existingRemarks || {});

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
            if (val) { draft[spec][hn] = val; } else { delete draft[spec][hn]; }
        });

        dialog.$wrapper.find(".qir-remark").each(function () {
            const hn  = $(this).data("hn");
            const val = $(this).val().trim();
            if (val) { remarkDraft[hn] = val; } else { delete remarkDraft[hn]; }
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

        const paramStatus = {};
        if (!noParams) {
            for (const p of params) {
                paramStatus[p.spec] = compute_row_overall_status(p, heatNumbers, draft[p.spec]);
            }
        }

        let headerCells = `<th class="qir-th qir-th--hn">NMTG Heat No</th>`;
        headerCells    += `<th class="qir-th qir-th--status">Overall</th>`;

        if (noParams) {
            headerCells += `<th class="qir-th" style="color:#999;">No parameters found in Readings table</th>`;
        } else {
            for (const p of params) {
                const st    = paramStatus[p.spec];
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

        headerCells += `<th class="qir-th qir-th--remark">Remark</th>`;

        let bodyRows = "";
        for (const hn of pageHeatNumbers) {
            const hnSt    = hnStatusMap[hn];
            const hnBadge = hnSt === "accepted"
                ? `<span class="qir-badge qir-badge--pass">✓ Accepted</span>`
                : hnSt === "rejected"
                ? `<span class="qir-badge qir-badge--fail">✗ Rejected</span>`
                : `<span class="qir-badge qir-badge--na">— N/A</span>`;

            let cells = `<td class="qir-td qir-td--hn">${frappe.utils.escape_html(hn)}</td>`;
            cells    += `<td class="qir-td qir-td--status">${hnBadge}</td>`;

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
                                      placeholder="Value"
                                  />
                              </td>`;
                }
            }

        const remark    = remarkDraft[hn] || "";
        const isReject  = hnStatusMap[hn] === "rejected";
        cells += `<td class="qir-td qir-td--remark">
                    <input
                        class="qir-remark${isReject ? " qir-remark--required" : ""}"
                        data-hn="${frappe.utils.escape_html(hn)}"
                        data-required="${isReject ? "1" : "0"}"
                        type="text"
                        value="${frappe.utils.escape_html(String(remark))}"
                        autocomplete="off"
                        placeholder="${isReject ? "Remark required ✱" : "Remark…"}"
                    />
                </td>`;

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
            .qir-th--remark {
                background: #f7f3ff;
                color: #5e35b1;
                min-width: 200px;
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
            .qir-td--remark {
                border: 1px solid #e4e9ef;
                padding: 6px 8px;
                vertical-align: middle;
                background: #faf8ff;
            }
            .qir-row:hover .qir-td,
            .qir-row:hover .qir-td--cell-pass,
            .qir-row:hover .qir-td--cell-fail,
            .qir-row:hover .qir-td--remark { filter: brightness(.97); }
            .qir-badge {
                display: inline-block;
                padding: 2px 9px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .03em;
                vertical-align: middle;
            }
            .qir-badge--pass    { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .qir-badge--fail    { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            .qir-badge--partial { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
            .qir-badge--na      { background: #e9ecef; color: #6c757d; border: 1px solid #dee2e6; }
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
            .qir-remark {
                width: 100%;
                min-width: 160px;
                border: 1px solid transparent;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 14px;
                background: transparent;
                color: #444;
                transition: border-color .15s, background .15s;
                box-sizing: border-box;
            }
            .qir-input:focus, .qir-remark:focus {
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
            .qir-remark--required {
            border-color: #f5c6cb !important;
            background: #fff8f8 !important;
            }
            .qir-remark--required:focus {
                border-color: #dc3545 !important;
                box-shadow: 0 0 0 2px rgba(220,53,69,.15) !important;
            }
            .qir-remark--required::placeholder {
                color: #dc3545;
                font-weight: 500;
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
       // REPLACE WITH:
primary_action() {
    capture_visible_inputs();

    // Validate: remark mandatory for rejected heat numbers
    const hnStatusMap = build_hn_status_map(heatNumbers, params, draft);
    const missing = heatNumbers.filter(hn =>
        hnStatusMap[hn] === "rejected" &&
        !(remarkDraft[hn] || "").trim()
    );

    if (missing.length) {
        // Navigate to the page containing the first offending HN
        const firstIdx  = heatNumbers.indexOf(missing[0]);
        const needsPage = Math.floor(firstIdx / PAGE_SIZE) + 1;
        if (needsPage !== currentPage) {
            currentPage = needsPage;
            render();
        }

        // Highlight all missing remark inputs on the current page
        setTimeout(() => {
            dialog.$wrapper.find(".qir-remark[data-required='1']").each(function () {
                if (!$(this).val().trim()) {
                    $(this).addClass("qir-remark--required").css("border-color", "#dc3545");
                }
            });
            const firstInput = dialog.$wrapper.find(".qir-remark[data-required='1']").filter(function () {
                return !$(this).val().trim();
            }).first();
            if (firstInput.length) firstInput.focus();
        }, 50);

        frappe.msgprint({
            title    : __("Remark Required"),
            message  : __(`<b>${missing.length}</b> rejected heat number(s) are missing a remark:<br><br>`)
                     + missing.slice(0, 10).map(hn => `<b>${frappe.utils.escape_html(hn)}</b>`).join(", ")
                     + (missing.length > 10 ? ` <i>… and ${missing.length - 10} more</i>` : ""),
            indicator: "red"
        });
        return;
    }

    save_readings(frm, params, heatNumbers, draft, remarkDraft, dialog);
}
    });

    dialog.show();
    bind_events();

    dialog.$wrapper.on("keydown", ".qir-input, .qir-remark", function (e) {
        const allInputs  = dialog.$wrapper.find(".qir-input, .qir-remark").toArray();
        const idx        = allInputs.indexOf(this);
        const colsPerRow = (params.length || 1) + 1;

        if (e.key === "Enter") {
            e.preventDefault();
            const next = allInputs[idx + colsPerRow];
            if (next) {
                next.focus(); next.select();
            } else if (currentPage < totalPages) {
                go_to_page(currentPage + 1);
                setTimeout(() => {
                    const first = dialog.$wrapper.find(".qir-input, .qir-remark").get(0);
                    if (first) { first.focus(); first.select(); }
                }, 0);
            }
        } else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const next = allInputs[idx + 1];
            if (next) { next.focus(); next.select(); }
        } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            const prev = allInputs[idx - 1];
            if (prev) { prev.focus(); prev.select(); }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Save readings back to child table rows + update parent totals
// ─────────────────────────────────────────────────────────────────────────────
function save_readings(frm, params, heatNumbers, draft, remarkDraft, dialog) {
    if (!params.length) {
        dialog.hide();
        return;
    }

    const params_by_spec = {};
    params.forEach(p => { params_by_spec[p.spec] = p; });

    frappe.db.get_doc("Item", frm.doc.item_code).then(item_doc => {
        const formula        = item_doc.custom_formula_for_conversion || "";
        const item_field_map = build_item_field_map(item_doc);

        console.log("[save_readings] formula:", formula);
        console.log("[save_readings] item_field_map:", item_field_map);
        console.log("[save_readings] draft:", JSON.stringify(draft));

        const set_value_promises = [];

        // ── Steps 1–3: per reading-row saves ────────────────────────────────
        (frm.doc.readings || []).forEach(row => {
            const spec = (row.specification || "").trim();
            if (!draft[spec]) return;

            // 1. Save reading details (values + remarks)
            const detailsToSave = Object.assign({}, draft[spec], {
                __remarks__: remarkDraft
            });

            set_value_promises.push(
                frappe.model.set_value(
                    row.doctype, row.name,
                    "custom_reading_details",
                    JSON.stringify(detailsToSave)
                ).catch(err => console.error("[save_readings] set custom_reading_details failed:", err))
            );

            // 2. Calculate & save total weight per reading row
            if (row.custom_calculate_weight_per_piece_kg && formula) {
                let total_weight  = 0;
                let weight_errors = 0;

                heatNumbers.forEach(hn => {
                    const param_value_map = build_param_value_map(params, draft, hn);
                    console.log(`[save_readings] HN: ${hn} | param_value_map:`, param_value_map);

                    const w = evaluate_formula(formula, item_field_map, param_value_map);
                    console.log(`[save_readings] HN: ${hn} | weight:`, w);

                    if (w !== null) {
                        total_weight += w;
                    } else {
                        weight_errors++;
                    }
                });

                console.log(`[save_readings] spec: ${spec} | total_weight: ${total_weight} | skipped HNs: ${weight_errors}`);

                set_value_promises.push(
                    frappe.model.set_value(
                        row.doctype, row.name,
                        "custom_total_weight_kg",
                        flt(total_weight, 3)
                    ).catch(err => console.error("[save_readings] set custom_total_weight_kg failed:", err))
                );
            } else {
                if (!formula) {
                    console.warn("[save_readings] Skipping weight: formula is empty on Item", frm.doc.item_code);
                }
                if (!row.custom_calculate_weight_per_piece_kg) {
                    console.warn("[save_readings] Skipping weight: custom_calculate_weight_per_piece_kg is falsy on row", row.name);
                }
            }

            // 3. Compute & save row-level status
            const param_meta = params_by_spec[spec];
            const rowStatus  = param_meta
                ? compute_row_overall_status(param_meta, heatNumbers, draft[spec])
                : null;

            if (rowStatus) {
                set_value_promises.push(
                    frappe.model.set_value(
                        row.doctype, row.name,
                        "status",
                        rowStatus
                    ).catch(err => console.error("[save_readings] set status failed:", err))
                );
            }
        });

        // ── Step 4: parent-level totals ──────────────────────────────────────
        const hnStatusMap = build_hn_status_map(heatNumbers, params, draft);

        // Find the Length(mm) param — by name first, fallback to first manual_inspection param
        const lengthParam = params.find(p => p.spec === "Length(mm)")
                         || params.find(p => p.manual_inspection);

        let total_accepted_mm  = 0;
        let total_rejected_mm  = 0;
        let total_accepted_kg  = 0;
        let total_rejected_kg  = 0;
        let total_accepted_qty = 0;
        let total_rejected_qty = 0;

        heatNumbers.forEach(hn => {
            const hnStatus = hnStatusMap[hn];

            // Skip HNs with no values entered
            if (hnStatus === "na") return;

            // MM contribution: sum of Length(mm) value for this HN
            if (lengthParam) {
                const lengthVal = parseFloat((draft[lengthParam.spec] || {})[hn]);
                if (!isNaN(lengthVal)) {
                    if (hnStatus === "accepted") {
                        total_accepted_mm += lengthVal;
                    } else if (hnStatus === "rejected") {
                        total_rejected_mm += lengthVal;
                    }
                }
            }

            // Weight contribution (only if formula exists)
            if (formula) {
                const param_value_map = build_param_value_map(params, draft, hn);
                const w = evaluate_formula(formula, item_field_map, param_value_map);

                if (w !== null) {
                    if (hnStatus === "accepted") {
                        total_accepted_kg += w;
                    } else if (hnStatus === "rejected") {
                        total_rejected_kg += w;
                    }
                }
            }

            // Qty contribution: count of accepted/rejected heat numbers
            if (hnStatus === "accepted") {
                total_accepted_qty++;
            } else if (hnStatus === "rejected") {
                total_rejected_qty++;
            }
        });

        console.log("[save_readings] parent totals →",
            "acc_mm:",  total_accepted_mm,
            "rej_mm:",  total_rejected_mm,
            "acc_kg:",  total_accepted_kg.toFixed(3),
            "rej_kg:",  total_rejected_kg.toFixed(3),
            "acc_qty:", total_accepted_qty,
            "rej_qty:", total_rejected_qty
        );

        set_value_promises.push(
            frappe.model.set_value(frm.doctype, frm.docname, "custom_total_accepted_in_mm", total_accepted_mm)
                .catch(err => console.error("[save_readings] set custom_total_accepted_in_mm failed:", err))
        );
        set_value_promises.push(
            frappe.model.set_value(frm.doctype, frm.docname, "custom_total_rejected_in_mm", total_rejected_mm)
                .catch(err => console.error("[save_readings] set custom_total_rejected_in_mm failed:", err))
        );
        set_value_promises.push(
            frappe.model.set_value(frm.doctype, frm.docname, "custom_total_accepted_in_kg", flt(total_accepted_kg, 3))
                .catch(err => console.error("[save_readings] set custom_total_accepted_in_kg failed:", err))
        );
        set_value_promises.push(
            frappe.model.set_value(frm.doctype, frm.docname, "custom_total_rejected_in_kg", flt(total_rejected_kg, 3))
                .catch(err => console.error("[save_readings] set custom_total_rejected_in_kg failed:", err))
        );
        set_value_promises.push(
            frappe.model.set_value(frm.doctype, frm.docname, "custom_total_accepted_qty", total_accepted_qty)
                .catch(err => console.error("[save_readings] set custom_total_accepted_qty failed:", err))
        );
        set_value_promises.push(
            frappe.model.set_value(frm.doctype, frm.docname, "custom_total_rejected_qty", total_rejected_qty)
                .catch(err => console.error("[save_readings] set custom_total_rejected_qty failed:", err))
        );

        // ── Flush all promises then save ─────────────────────────────────────
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
                frappe.show_alert({ message: __("Readings saved"), indicator: "green" });
            });
        }).catch(err => {
            console.error("[save_readings] Promise.all failed:", err);
            frappe.msgprint({
                title: __("Save Error"),
                message: __("Some readings could not be saved. Check the browser console for details."),
                indicator: "red"
            });
        });

    }).catch(err => {
        console.error("[save_readings] Failed to fetch Item doc:", err);
        frappe.msgprint({
            title: __("Item Fetch Error"),
            message: __("Could not load Item details for weight calculation."),
            indicator: "red"
        });
    });
}
// ─────────────────────────────────────────────────────────────────────────────
// Update Quality Inspection parent status from all reading row statuses
// ─────────────────────────────────────────────────────────────────────────────
function update_parent_status(frm) {
    const statuses = (frm.doc.readings || [])
        .map(r => (r.status || "").trim())
        .filter(s => s);

    if (!statuses.length) return;

    const allAccepted = statuses.every(s => s === "Accepted");
    const allRejected = statuses.every(s => s === "Rejected");

    frm.set_value("status",
        allAccepted ? "Accepted" :
        allRejected ? "Rejected" :
        "Partially Accepted"
    );
}