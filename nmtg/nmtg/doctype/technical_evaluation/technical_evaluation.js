// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt
frappe.ui.form.on("Technical Evaluation Item", {
    form_render(frm, cdt, cdn) {
        set_competitor_name_options(frm, cdt, cdn);
        set_competitor_model_options(frm, cdt, cdn);
        render_attachment_slots(frm, cdt, cdn);
        render_dynamic_required_fields(frm, cdt, cdn);
        apply_row_lock(frm, cdt, cdn);
    },

    attachment_qty(frm, cdt, cdn) {
        sync_attachment_rows(frm, cdt, cdn);
        render_attachment_slots(frm, cdt, cdn);
    },
    drawing_approval_required(frm, cdt, cdn) {
        render_attachment_slots(frm, cdt, cdn);
    },
    items_render(frm, cdt, cdn) {
        set_competitor_name_options(frm, cdt, cdn);
        set_competitor_model_options(frm, cdt, cdn);
    },

    product_group(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        frappe.model.set_value(cdt, cdn, "competitor_name", "");
        frappe.model.set_value(cdt, cdn, "competitor_model", "");
        frappe.model.set_value(cdt, cdn, "nmtg_model", "");
        update_select_field_options(frm, cdt, cdn, "competitor_model", [""]);
        set_competitor_name_options(frm, cdt, cdn);
        render_dynamic_required_fields(frm, cdt, cdn);
    },

    competitor_name(frm, cdt, cdn) {
        frappe.model.set_value(cdt, cdn, "competitor_model", "");
        frappe.model.set_value(cdt, cdn, "nmtg_model", "");
        set_competitor_model_options(frm, cdt, cdn);
    },

    competitor_model(frm, cdt, cdn) {
        set_nmtg_model_from_competitor_model(frm, cdt, cdn);
    },

    nmtg_model(frm, cdt, cdn) {
        render_dynamic_required_fields(frm, cdt, cdn);
    },

    // NEW: fetch comma separated customer codes from Item
    item_code(frm, cdt, cdn) {
        set_customer_codes_from_item(frm, cdt, cdn);
    },

    clarification_required: function(frm, cdt, cdn) {
        toggle_questionary_visibility(frm);
    },
    items_remove: function(frm) {
        toggle_questionary_visibility(frm);
    },
    request_no: function(frm) {
        set_request_no_options(frm);
    },
    create_feasibility_review: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (row.feasibility_review_report) {
            frappe.set_route("Form", "Feasibility Review Report", row.feasibility_review_report);
            return;
        }

        if (!row.item_code) {
            frappe.msgprint(__("Please set Item Code before creating a Feasibility Review."));
            return;
        }

        frappe.confirm(
            __("Create a new Feasibility Review Report for this item?"),
            function() {
                const categories = [
                    "Technical Capability",
                    "Infrastructure Feasibility",
                    "Existing Work Load Vs Time Line",
                    "Staff",
                    "Budgets & Financial Matters",
                    "Other",
                    "Statutory & Regulatory Requirements"
                ];

                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Feasibility Review Report",
                            customer: frm.doc.customer,
                            customer_part_no: row.item_code,
                            ref_customer_document_no: frm.doc.name,
                            ref_enquiry: frm.doc.opportunity_no,
                            prepared_by: frappe.session.user,
                            date: frappe.datetime.get_today(),
                            feasibility_checkpoints: categories.map(cat => ({ category: cat })),
                            customer_part_name: row.item_name
                        }
                    },
                    freeze: true,
                    freeze_message: __("Creating Feasibility Review Report..."),
                    callback: function(r) {
                        if (r.message) {
                            frappe.model.set_value(cdt, cdn, "feasibility_review_report", r.message.name);

                            frm.save().then(() => {
                                frappe.show_alert({
                                    message: __("Feasibility Review Report {0} created", [r.message.name]),
                                    indicator: "green"
                                });
                                frappe.set_route("Form", "Feasibility Review Report", r.message.name);
                            });
                        }
                    }
                });
            }
        );
    },
    download_apqp: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        frappe.call({
            method: "nmtg.override.api.generate_apqp_template",
            args: { parent: frm.doc.name, item_row: row.name },
            freeze: true,
            freeze_message: __("Generating APQP..."),
            callback: function(r) {
                if (r.message) {
                    window.open(r.message);
                }
            }
        });
    },
    not_in_nmtg_scope(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (cint(row.not_in_nmtg_scope)) {
            frappe.model
                .set_value(cdt, cdn, "nmtg_model", NOT_IN_SCOPE_MODEL)
                .then(() =>
                    frappe.model.set_value(cdt, cdn, "item_code", NOT_IN_SCOPE_ITEM)
                )
                .then(() => apply_row_lock(frm, cdt, cdn));
        } else {
            const updates = [];
            if (row.nmtg_model === NOT_IN_SCOPE_MODEL) {
                updates.push(frappe.model.set_value(cdt, cdn, "nmtg_model", ""));
            }
            if (row.item_code === NOT_IN_SCOPE_ITEM) {
                updates.push(frappe.model.set_value(cdt, cdn, "item_code", ""));
                updates.push(frappe.model.set_value(cdt, cdn, "item_name", ""));
                updates.push(frappe.model.set_value(cdt, cdn, "custom_customer_code", ""));
            }
            Promise.all(updates).then(() => apply_row_lock(frm, cdt, cdn));
        }
    },

});

function set_customer_codes_from_item(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    if (!row.item_code || row.item_code === NOT_IN_SCOPE_ITEM) {
        frappe.model.set_value(cdt, cdn, "custom_customer_code", "");
        return;
    }

    frappe.call({
        method: "frappe.client.get",
        args: { doctype: "Item", name: row.item_code },
        callback(r) {
            const item = r.message || {};
            const codes = (item.customer_items || [])
                .filter(d => !frm.doc.customer || d.customer_name === frm.doc.customer)
                .map(d => (d.ref_code || "").trim())
                .filter(Boolean);

            const value = [...new Set(codes)].join(",");
            frappe.model.set_value(cdt, cdn, "custom_customer_code", value);
        }
    });
}
frappe.ui.form.on(cur_frm ? cur_frm.doctype : "Technical Evaluation", {
    setup(frm) {
        // Email composer in the Activities tab pre-fills from this field
        frm.email_field = "email";
        set_item_code_query(frm);
    },

    refresh(frm) {

        setTimeout(() => apply_all_row_locks(frm), 300);

        (frm.doc.items || []).forEach(row => {
            set_competitor_name_options(frm, row.doctype, row.name);
            set_competitor_model_options(frm, row.doctype, row.name);
        });
        toggle_questionary_visibility(frm);
        set_request_no_options(frm);

        if (frm.is_new()) return;

        render_crm_notes(frm);
        render_crm_activities(frm);

        let has_pending = (frm.doc.items || []).some(
            it => it.drawing_approval_required === "Yes" && !it.drawing_email_sent
        );

        if (has_pending) {
            frm.add_custom_button("Send Drawing Verification Emails", function() {
                frappe.confirm(
                    "Send drawing verification emails for all pending items in this document?",
                    () => {
                        frappe.call({
                            method: "nmtg.nmtg.doctype.technical_evaluation.technical_evaluation.send_drawing_verification_emails_for_doc",
                            args: { docname: frm.doc.name },
                            freeze: true,
                            freeze_message: "Sending emails...",
                            callback: function(r) {
                                if (!r.exc && r.message) {
                                    let sent = r.message.sent || [];
                                    let skipped = r.message.skipped || [];

                                    let summary = `<b>Sent:</b> ${sent.length}`;
                                    if (skipped.length) {
                                        summary += `<br><b>Skipped (no recipient/attachment):</b> ${skipped.length}<br>${skipped.join("<br>")}`;
                                    }

                                    frappe.msgprint({
                                        title: "Drawing Verification Emails",
                                        message: summary,
                                        indicator: sent.length ? "green" : "orange"
                                    });

                                    frm.reload_doc();
                                }
                            }
                        });
                    }
                );
            }).addClass("btn-primary");
        }
        set_item_filter(frm);
    },

    table_fbef_add(frm) {
        set_item_filter(frm);
    },

    items_add: function(frm) {
        set_request_no_options(frm);
        set_item_filter(frm);
    },
    items_remove: function(frm) {
        set_request_no_options(frm);
        set_item_filter(frm);
    },
    onload: function (frm) {
        if (frm.is_new() && !frm.doc.lead_engineer) {
            frm.set_value("lead_engineer", frappe.session.user);
        }
    },
    send_questionary_to_customer: function (frm) {
        if (frm.is_new()) {
            frappe.msgprint(__("Please save the document before sending the questionary."));
            return;
        }

        if (
            !frm.doc.questionary_for_technical_evaluation ||
            !frm.doc.questionary_for_technical_evaluation.length
        ) {
            frappe.msgprint(
                __("Please add at least one row in Questionary For Technical Evaluation before sending.")
            );
            return;
        }

        if (!frm.doc.email) {
            frappe.msgprint(__("Please set the Email field before sending the questionary."));
            return;
        }

        frappe.confirm(
            __("Send the questionary link to {0}?", [frm.doc.email]),
            function () {
                frappe.call({
                    method: "nmtg.override.api.send_technical_evaluation_questionary",
                    args: { technical_evaluation: frm.doc.name },
                    freeze: true,
                    freeze_message: __("Sending..."),
                    callback: function (r) {
                        if (!r.exc) {
                            frappe.show_alert({
                                message: __("Questionary email sent to {0}", [frm.doc.email]),
                                indicator: "green",
                            });
                            frm.reload_doc();
                        }
                    },
                });
            }
        );
    },
    assign_to_responsible_users: function (frm) {
        if (frm.is_new()) {
            frappe.msgprint(__("Please save the document first."));
            return;
        }
        frappe.call({
            method: "nmtg.override.api.assign_to_responsible_users",
            args: { doctype: frm.doc.doctype, docname: frm.doc.name },
            freeze: true,
            freeze_message: __("Assigning..."),
            callback: function () {
                frm.reload_doc();
            },
        });
    },
});


frappe.ui.form.on('Questionary For Technical Evaluation', {
    questionary_for_technical_evaluation_add: function(frm) {
        set_request_no_options(frm);
    }
});

// ---------------------------------------------------------------------------
// Notes / Activities tabs (same widgets Lead uses)
// ---------------------------------------------------------------------------

function render_crm_notes(frm) {
    if (frm.is_new() || frm.doc.docstatus == 1) return;
    if (!frm.fields_dict.notes_html) return;

    const crm_notes = new erpnext.utils.CRMNotes({
        frm: frm,
        notes_wrapper: $(frm.fields_dict.notes_html.wrapper),
    });
    crm_notes.refresh();
}

function render_crm_activities(frm) {
    if (frm.is_new() || frm.doc.docstatus == 1) return;
    if (!frm.fields_dict.open_activities_html || !frm.fields_dict.all_activities) return;

    const crm_activities = new erpnext.utils.CRMActivities({
        frm: frm,
        open_activities_wrapper: $(frm.fields_dict.open_activities_html.wrapper),
        all_activities_wrapper: $(frm.fields_dict.all_activities.wrapper),
        form_wrapper: $(frm.wrapper),
    });
    crm_activities.refresh();
}

// ---------------------------------------------------------------------------
// Request No options
// ---------------------------------------------------------------------------

function set_request_no_options(frm) {
    let request_nos = [...new Set(
        (frm.doc.items || [])
            .map(d => d.request_no)
            .filter(d => d)
    )];

    let options = [""].concat(request_nos).join('\n');

    frm.fields_dict['questionary_for_technical_evaluation'].grid.update_docfield_property(
        'request_no', 'options', options
    );

    frm.refresh_field('questionary_for_technical_evaluation');
}

// Step 1: Product Group -> Competitor Name options (distinct brands)
function set_competitor_name_options(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group) {
        update_select_field_options(frm, cdt, cdn, "competitor_name", [""]);
        return;
    }

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let options = [""];
        (pg_doc.competitor_model || []).forEach(r => {
            if (r.competitor_model && !options.includes(r.competitor_model)) {
                options.push(r.competitor_model);
            }
        });
        update_select_field_options(frm, cdt, cdn, "competitor_name", options);
    });
}

// Step 2: Product Group + Competitor Name -> Competitor Model options
function set_competitor_model_options(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group || !row.competitor_name) {
        update_select_field_options(frm, cdt, cdn, "competitor_model", [""]);
        return;
    }

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let options = [""];
        (pg_doc.competitor_model || []).forEach(r => {
            if (r.competitor_model !== row.competitor_name) return;
            if (r.competitor_model_name && !options.includes(r.competitor_model_name)) {
                options.push(r.competitor_model_name);
            }
        });
        update_select_field_options(frm, cdt, cdn, "competitor_model", options);
    });
}

// Step 3: Product Group + Competitor Name + Competitor Model -> auto-fill NMTG Model
function set_nmtg_model_from_competitor_model(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group || !row.competitor_name || !row.competitor_model) return;

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let match = (pg_doc.competitor_model || []).find(r =>
            r.competitor_model === row.competitor_name &&
            r.competitor_model_name === row.competitor_model
        );
        if (match) {
            frappe.model.set_value(cdt, cdn, "nmtg_model", match.model);
        } else {
            // No match resolved -> make sure nmtg_model is cleared so the
            // dynamic fields block hides again via the nmtg_model trigger.
            frappe.model.set_value(cdt, cdn, "nmtg_model", "");
        }
    });
}

// Generic helper to push new Select options into a grid row's inline + expanded editors
function update_select_field_options(frm, cdt, cdn, fieldname, options) {
    let row = locals[cdt][cdn];
    let options_str = options.join("\n");

    let grid = frm.fields_dict[row.parentfield].grid;
    let grid_row = grid.grid_rows_by_docname[cdn];
    if (!grid_row) return;

    let docfield = grid_row.docfields.find(df => df.fieldname === fieldname);
    if (docfield) docfield.options = options_str;

    let grid_field = grid.get_field(fieldname);
    if (grid_field && grid_field.df) grid_field.df.options = options_str;

    if (grid_row.refresh_field) {
        grid_row.refresh_field(fieldname);
    } else if (grid_row.columns && grid_row.columns[fieldname]) {
        grid_row.columns[fieldname].df.options = options_str;
        grid_row.columns[fieldname].field &&
            grid_row.columns[fieldname].field.set_options &&
            grid_row.columns[fieldname].field.set_options(options_str);
    }

    if (grid_row.grid_form && grid_row.grid_form.fields_dict[fieldname]) {
        grid_row.grid_form.fields_dict[fieldname].df.options = options_str;
        grid_row.grid_form.fields_dict[fieldname].refresh();
    }
}

function toggle_questionary_visibility(frm) {
    const has_clarification = (frm.doc.items || []).some(
        row => row.clarification_required === 'Yes'
    );

    frm.toggle_display('questionary_for_technical_evaluation', has_clarification);
    frm.toggle_display('send_questionary_to_customer', has_clarification);
    frm.refresh_field('questionary_for_technical_evaluation');
}

function get_html_wrapper(frm, cdt, cdn) {
    let grid_row = frm.fields_dict["items"].grid.grid_rows_by_docname[cdn];
    if (!grid_row || !grid_row.grid_form) return null;
    let field = grid_row.grid_form.fields_dict["attachment"];
    return field ? field.$wrapper : null;
}

// Trim/pad the parent's Attachment table to match attachment_qty for this request_no
function sync_attachment_rows(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.request_no) return;

    let linked = (frm.doc.attachment || []).filter(a => a.request_no === row.request_no);
    let qty = cint(row.attachment_qty);

    if (linked.length > qty) {
        let to_remove = linked.slice(qty).filter(a => !a.attachment);
        to_remove.forEach(a => frm.get_field("attachment").grid.grid_rows_by_docname[a.name].remove());
    }
    frm.refresh_field("attachment");
}

function render_attachment_slots(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let $wrapper = get_html_wrapper(frm, cdt, cdn);
    if (!$wrapper) return;

    $wrapper.empty();

    if (row.drawing_approval_required !== "Yes" || !row.attachment_qty) {
        $wrapper.append(`<div class="text-muted" style="font-size:12px;">Set "Drawing Approval Required" to Yes and enter Attachment Qty to add files.</div>`);
        return;
    }
    if (!row.request_no) {
        $wrapper.append(`<div class="text-muted" style="font-size:12px;">Request No not set on this row yet.</div>`);
        return;
    }

    let existing = (frm.doc.attachment || []).filter(a => a.request_no === row.request_no);
    let $container = $('<div style="display:flex;flex-wrap:wrap;gap:8px;"></div>').appendTo($wrapper);

    for (let i = 0; i < cint(row.attachment_qty); i++) {
        let existing_row = existing[i];
        let $slot = $(`
            <div style="border:1px solid var(--border-color);padding:6px 10px;border-radius:6px;min-width:140px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Attachment ${i + 1}</div>
                <button class="btn btn-xs btn-default attach-btn" type="button">
                    ${existing_row ? "Replace" : "Upload"}
                </button>
                ${existing_row ? `<a href="${existing_row.attachment}" target="_blank" style="margin-left:6px;font-size:12px;">View</a>` : ""}
            </div>
        `);

        $slot.find(".attach-btn").on("click", () => {
            new frappe.ui.FileUploader({
                doctype: frm.doctype,
                docname: frm.doc.name,
                folder: "Home/Attachments",
                on_success: (file_doc) => {
                    if (existing_row) {
                        existing_row.attachment = file_doc.file_url;
                    } else {
                        let child = frm.add_child("attachment");
                        child.request_no = row.request_no;
                        child.attachment = file_doc.file_url;
                    }
                    frm.refresh_field("attachment");
                    render_attachment_slots(frm, cdt, cdn);
                }
            });
        });

        $container.append($slot);
    }
}

let _item_meta_fields_cache = null;

function ensure_item_meta(callback) {
    if (_item_meta_fields_cache) {
        callback();
        return;
    }
    frappe.model.with_doctype("Item", function () {
        _item_meta_fields_cache = frappe.get_meta("Item").fields;
        callback();
    });
}

function get_item_field_meta(fieldname) {
    if (!_item_meta_fields_cache) return null;
    return _item_meta_fields_cache.find(f => f.fieldname === fieldname);
}

function get_or_create_status_wrapper(grid_row) {
    if (!grid_row || !grid_row.grid_form || !grid_row.grid_form.fields_dict.feilds) {
        return null;
    }
    let $wrapper = $(grid_row.grid_form.fields_dict.feilds.wrapper);
    let $status = $wrapper.find(".required-fields-match-status");
    if (!$status.length) {
        $status = $(`<div class="required-fields-match-status" style="margin-top:8px;"></div>`);
        $wrapper.append($status);
    }
    return $status;
}

const ITEM_MODEL_FIELDNAME = "custom_sub_product_group";

function try_autofetch_item_code(frm, cdt, cdn, fieldnames, values) {
    let row = locals[cdt][cdn];

    let complete =
        !!row.nmtg_model &&
        fieldnames.every(fn =>
            values[fn] !== undefined && values[fn] !== null && values[fn] !== ""
        );

    let grid_row = frm.open_grid_row();
    let $status = get_or_create_status_wrapper(grid_row);

    if (!complete) {
        if ($status) $status.empty();
        return;
    }

    let filters = {};
    fieldnames.forEach(fn => { filters[fn] = values[fn]; });
    filters[ITEM_MODEL_FIELDNAME] = row.nmtg_model;

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Item",
            filters: filters,
            fields: ["name", "item_name"],
            limit_page_length: 2
        },
        callback: function (r) {
            let matches = r.message || [];

            if (matches.length === 1) {
                if (row.item_code !== matches[0].name) {
                    frappe.model.set_value(cdt, cdn, "item_code", matches[0].name);
                }
                if (row.item_name !== matches[0].item_name) {
                    frappe.model.set_value(cdt, cdn, "item_name", matches[0].item_name);
                }
                if ($status) {
                    $status.html(
                        `<div style="font-size:12px;color:var(--text-success,green);">✓ Matched: ${frappe.utils.escape_html(matches[0].name)} — ${frappe.utils.escape_html(matches[0].item_name || "")}</div>`
                    );
                }
            } else if (matches.length > 1) {
                if ($status) {
                    $status.html(
                        `<div style="font-size:12px;color:var(--text-warning,#b8860b);">Multiple items match — Item Code list below is filtered by the required fields entered. Please select one.</div>`
                    );
                }
            } else {
                if ($status) {
                    $status.html(
                        `<div style="font-size:12px;color:var(--text-danger,#c0392b);">No matching Item found for this combination. Item Code is required — select or create one manually below.</div>`
                    );
                }
            }
        }
    });
}

function render_dynamic_required_fields(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    let grid_row = frm.open_grid_row();
    if (!grid_row || !grid_row.grid_form || !grid_row.grid_form.fields_dict.feilds) {
        return;
    }

    let $wrapper = $(grid_row.grid_form.fields_dict.feilds.wrapper);
    $wrapper.empty();

    if (!row.product_group) {
        return;
    }

    if (!row.nmtg_model) {
        $wrapper.append(
            `<div class="text-muted" style="font-size:12px;">Select Competitor Name / Competitor Model to resolve an NMTG Model before entering required fields.</div>`
        );
        return;
    }

    frappe.db.get_value(
        "Product Group",
        row.product_group,
        "required_fields_value",
        function (r) {
            let csv = (r && r.required_fields_value) || "";
            let fieldnames = csv.split(",").map(x => x.trim()).filter(Boolean);

            if (!fieldnames.length) {
                $wrapper.append(
                    `<div class="text-muted" style="font-size:12px;">No required fields configured for this Product Group.</div>`
                );
                return;
            }

            ensure_item_meta(function () {
                let saved_values = {};
                if (row.required_feilds) {
                    try {
                        saved_values = JSON.parse(row.required_feilds);
                    } catch (e) {
                        saved_values = {};
                    }
                }

                let $grid = $(
                    `<div class="dynamic-required-fields" style="display:flex; flex-wrap:wrap; gap:10px;"></div>`
                );
                $wrapper.append($grid);

                let controls = {};

                let restore_promises = [];

                function save_values() {
                    let values = {};
                    fieldnames.forEach(fn => {
                        let ctrl = controls[fn];
                        if (!ctrl) return;
                        let v = ctrl.get_value();
                        if (v !== null && v !== undefined && v !== "") {
                            values[fn] = v;
                        }
                    });
                    frappe.model.set_value(cdt, cdn, "required_feilds", JSON.stringify(values));
                    try_autofetch_item_code(frm, cdt, cdn, fieldnames, values);
                }

                fieldnames.forEach(function (fn) {
                    let meta_field = get_item_field_meta(fn);
                    if (!meta_field) return;

                    let $field_wrap = $(`<div style="min-width:180px;"></div>`);
                    $grid.append($field_wrap);

                    let control = frappe.ui.form.make_control({
                        parent: $field_wrap,
                        df: {
                            fieldtype: meta_field.fieldtype,
                            label: meta_field.label || fn,
                            fieldname: fn,
                            options: meta_field.options
                        },
                        render_input: true
                    });
                    control.refresh();

                    if (saved_values[fn] !== undefined) {
                        restore_promises.push(
                            Promise.resolve(control.set_value(saved_values[fn]))
                        );
                    }

                    control.$input && control.$input.on("change", save_values);
                    controls[fn] = control;
                });

                Promise.all(restore_promises).then(save_values);
            });
        }
    );
}

function set_item_filter(frm) {
    const item_codes = (frm.doc.items || [])
        .map(row => row.item_code)
        .filter(Boolean);

    frm.set_query("item_code", "table_fbef", function () {
        return {
            filters: {
                name: ["in", item_codes]
            }
        };
    });
}

// Filter the Item Code dropdown on an items row by the saved required-field
// values + NMTG model (so "Multiple items match" shows only the matches).
function set_item_code_query(frm) {
    frm.set_query("item_code", "items", function (doc, cdt, cdn) {
        const row = locals[cdt][cdn];

        // "Not In Scope" rows keep the default behaviour
        if (!row || cint(row.not_in_nmtg_scope)) {
            return {};
        }

        let values = {};
        try {
            values = JSON.parse(row.required_feilds || "{}") || {};
        } catch (e) {
            values = {};
        }

        let filters = {};
        Object.keys(values).forEach(fn => {
            let v = values[fn];
            if (v !== undefined && v !== null && v !== "") {
                filters[fn] = v;
            }
        });

        // Nothing entered yet -> don't restrict the list
        if (!Object.keys(filters).length) {
            return {};
        }

        if (row.nmtg_model) {
            filters[ITEM_MODEL_FIELDNAME] = row.nmtg_model;
        }

        return { filters: filters };
    });
}


const NOT_IN_SCOPE_MODEL = "Not In Scope";
const NOT_IN_SCOPE_ITEM = "Not In NMTG's Scope";
const CHILD_DOCTYPE = "Technical Evaluation Item";

const LAYOUT_TYPES = [
    "Section Break",
    "Column Break",
    "Tab Break",
    "HTML",
    "Heading",
    "Image",
];

function get_lockable_fields() {
    return frappe
        .get_meta(CHILD_DOCTYPE)
        .fields.filter(
            (df) =>
                !LAYOUT_TYPES.includes(df.fieldtype) &&
                df.fieldname !== "not_in_nmtg_scope" &&
                !df.read_only &&
                !df.hidden
        )
        .map((df) => df.fieldname);
}

function apply_row_lock(frm, cdt, cdn) {
    const row = locals[cdt] && locals[cdt][cdn];
    if (!row) return;

    const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
    if (!grid || !grid.grid_rows_by_docname) return;

    const grid_row = grid.grid_rows_by_docname[cdn];
    if (!grid_row) return;

    const editable = !cint(row.not_in_nmtg_scope);
    get_lockable_fields().forEach((fieldname) => {
        grid_row.toggle_editable(fieldname, editable);
    });
}

function apply_all_row_locks(frm) {
    (frm.doc.items || []).forEach((row) => {
        apply_row_lock(frm, row.doctype, row.name);
    });
}