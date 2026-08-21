// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt
frappe.ui.form.on("Supplier Registration Form", {
    refresh(frm) {
        frm.fields_dict.rating_image.$wrapper.html(`
            <div style="text-align:center;">
                <img
                    src="/files/Screenshot%20from%202026-07-07%2014-34-47.png"
                    style="max-width:100%; height:auto; border-radius:4px;"
                >
            </div>
        `);
         toggle_all_cert_locks(frm);
    },
    supplier_type: function(frm) {
        calculate_legal_registration_score(frm);
    },
    gst_no: function(frm) {
        calculate_legal_registration_score(frm);
    },
    pan_no: function(frm) {
        calculate_legal_registration_score(frm);
    },
    vat__tin_no: function(frm) {
        calculate_legal_registration_score(frm);
    },
    taxpayer_identification_no__vat_id__ein: function(frm) {
        calculate_legal_registration_score(frm);
    },
    year_established: function(frm) {
        calculate_years_in_business_score(frm);
    },
    production_capacity_suitable_for_our_demand: function(frm) {
        calculate_production_capacity_score(frm);
    },
    production_capacity_details: function(frm) {
        calculate_production_capacity_score(frm);
    },
    iso_9001: function(frm) {
        calculate_quality_management_score(frm);
    },
    iatf_16949: function(frm) {
        calculate_quality_management_score(frm);
    },
    attach_certificate_iso_9001: function(frm) {
        calculate_quality_management_score(frm);
    },
    attach_certificate_iatf_16949: function(frm) {
        calculate_quality_management_score(frm);
    },
    inspection_testing_facility: function(frm) {
        calculate_simple_checkbox_score(frm, "inspection_testing_facility", "Inspection & Testing Facility");
    },
    calibration_system: function(frm) {
        calculate_simple_checkbox_score(frm, "calibration_system", "Calibration System");
    },
    traceability_system_erp: function(frm) {
        calculate_simple_checkbox_score(frm, "traceability_system_erp", "Traceability System/ ERP");
    },
    customer_complaint__capa_system: function(frm) {
        calculate_simple_checkbox_score(frm, "customer_complaint__capa_system", "Customer Complaint / CAPA System");
    },
    iso_14001: function(frm) {
        calculate_checkbox_with_attachment_score(frm, "iso_14001", "attach_certificate_iso_14001", "ISO 14001");
    },
    attach_certificate_iso_14001: function(frm) {
        calculate_checkbox_with_attachment_score(frm, "iso_14001", "attach_certificate_iso_14001", "ISO 14001");
    },
    iso_45001: function(frm) {
        calculate_checkbox_with_attachment_score(frm, "iso_45001", "attach_certificate_iso_45001", "ISO 45001");
    },
    attach_certificate_iso_45001: function(frm) {
        calculate_checkbox_with_attachment_score(frm, "iso_45001", "attach_certificate_iso_45001", "ISO 45001");
    },
    iso_50001: function(frm) {
        calculate_checkbox_with_attachment_score(frm, "iso_50001", "attach_certificate_iso_50001", "ISO 50001");
    },
    attach_certificate_iso_50001: function(frm) {
        calculate_checkbox_with_attachment_score(frm, "iso_50001", "attach_certificate_iso_50001", "ISO 50001");
    },
    esg__sustainability__ghg_reporting: function(frm) {
        calculate_ghg_accounting_score(frm);
    },
    esg__sustainability_ghg_reporting: function(frm) {
        calculate_ghg_accounting_score(frm);
    },
    working__capital: function(frm) {
        calculate_financial_stability_score(frm);
    },
    turnover: function(frm) {
        calculate_financial_stability_score(frm);
    },
    onload: function(frm) {
        calculate_legal_registration_score(frm);
        calculate_years_in_business_score(frm);
        calculate_production_capacity_score(frm);
        calculate_quality_management_score(frm);
        calculate_simple_checkbox_score(frm, "inspection_testing_facility", "Inspection & Testing Facility");
        calculate_simple_checkbox_score(frm, "calibration_system", "Calibration System");
        calculate_simple_checkbox_score(frm, "traceability_system_erp", "Traceability System/ ERP");
        calculate_simple_checkbox_score(frm, "customer_complaint__capa_system", "Customer Complaint / CAPA System");
        calculate_checkbox_with_attachment_score(frm, "iso_14001", "attach_certificate_iso_14001", "ISO 14001");
        calculate_checkbox_with_attachment_score(frm, "iso_45001", "attach_certificate_iso_45001", "ISO 45001");
        calculate_checkbox_with_attachment_score(frm, "iso_50001", "attach_certificate_iso_50001", "ISO 50001");
        calculate_ghg_accounting_score(frm);
        calculate_financial_stability_score(frm);
    },
    // IATF 16949
    iatf_16949(frm) { toggle_all_cert_locks(frm); },
    date_of_registration_iatf_16949(frm) { toggle_all_cert_locks(frm); },
    date_of_expiry_iatf_16949(frm) { toggle_all_cert_locks(frm); },

    // ISO 9001
    iso_9001(frm) { toggle_all_cert_locks(frm); },
    date_of_registration_iso_9001(frm) { toggle_all_cert_locks(frm); },
    date_of_expiry_iso_9001(frm) { toggle_all_cert_locks(frm); },

    // ISO 14001
    iso_14001(frm) { toggle_all_cert_locks(frm); },
    date_of_registration_iso_14001(frm) { toggle_all_cert_locks(frm); },
    date_of_expiry_iso_14001(frm) { toggle_all_cert_locks(frm); },

    // ISO 45001
    iso_45001(frm) { toggle_all_cert_locks(frm); },
    date_of_registration__iso_45001(frm) { toggle_all_cert_locks(frm); },
    date_of_expiry_iso_45001(frm) { toggle_all_cert_locks(frm); },

    // ISO 50001
    iso_50001(frm) { toggle_all_cert_locks(frm); },
    date_of_registration_iso_50001(frm) { toggle_all_cert_locks(frm); },
    date_of_expiry_iso_50001(frm) { toggle_all_cert_locks(frm); },

    // Other Standard
    other_standard(frm) { toggle_all_cert_locks(frm); },
    date_of_registration(frm) { toggle_all_cert_locks(frm); },
    date_of_expiry(frm) { toggle_all_cert_locks(frm); },
    
   onload: function(frm) {
    if (frm.is_new() && (!frm.doc.department_info || frm.doc.department_info.length === 0)) {
        const departments = ['Quality', 'Purchase', 'Account', 'Logistic'];
        departments.forEach(dept => {
            let row = frm.add_child('department_info');
            row.department = dept;
        });
        frm.refresh_field('department_info');
    }

    if (frm.is_new() && (!frm.doc.domestic_supplier_document_checklist || frm.doc.domestic_supplier_document_checklist.length === 0)) {
        const domestic_docs = [
            'GST Certificate',
            'PAN Card',
            'Cancelled Cheque Copy',
            'MSME Certificate',
            'List of Equipment with Make, Mfg. Date and Capacity',
            'List of Instruments with Make, Mfg. Date and Capacity',
            'List of Machinery with Make, Mfg. Date and Capacity',
            'Other Supporting Document',
            'VAT / TIN No.'
        ];
        domestic_docs.forEach(doc_name => {
            let row = frm.add_child('domestic_supplier_document_checklist');
            row.requirement__document = doc_name;
        });
        frm.refresh_field('domestic_supplier_document_checklist');
    }

    if (frm.is_new() && (!frm.doc.international_supplier_document_checklist || frm.doc.international_supplier_document_checklist.length === 0)) {
        const international_docs = [
            'Taxpayer Identification Certificate',
            'BIS Certificate',
            'Import / Export License',
            'Product Catalogue',
            'Other Supporting Document'
        ];
        international_docs.forEach(doc_name => {
            let row = frm.add_child('international_supplier_document_checklist');
            row.requirement__document = doc_name;
        });
        frm.refresh_field('international_supplier_document_checklist');
    }
},
    
    before_save(frm) {

        // At least one business activity should be selected
        const business_activity_fields = [
            'service_provider__subcontractor',
            'dealerdistributor',
            'trader',
            'manufacture',
            'other_mul'
        ];

        const is_any_checked = business_activity_fields.some(
            fieldname => frm.doc[fieldname] == 1
        );

        if (!is_any_checked) {
            frappe.throw(__('Please select at least one Business Activity.'));
        }


        // Email Validation
        if (frm.doc.email_id) {
            const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (!email_regex.test(frm.doc.email_id)) {
                frappe.throw(__('Please enter a valid Email ID.'));
            }
        }


        // GSTIN Validation
        if (frm.doc.gst_no) {
            const gst_regex =
                /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

            if (!gst_regex.test(frm.doc.gst_no.toUpperCase())) {
                frappe.throw(__('Please enter a valid GST Number (GSTIN).'));
            }
        }


        // PAN Validation
        if (frm.doc.pan_no) {
            const pan_regex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

            if (!pan_regex.test(frm.doc.pan_no.toUpperCase())) {
                frappe.throw(__('Please enter a valid PAN Number.'));
            }
        }
    }
});



function toggle_all_cert_locks(frm) {
    const today = frappe.datetime.get_today();

    // Each block: [enable_checkbox, expiry_fieldname, [fields_to_lock]]
    const cert_blocks = [
        [
            "iatf_16949",
            "date_of_expiry_iatf_16949",
            ["attach_certificate_iatf_16949", "date_of_registration_iatf_16949", "date_of_expiry_iatf_16949"]
        ],
        [
            "iso_9001",
            "date_of_expiry_iso_9001",
            ["attach_certificate_iso_9001", "date_of_registration_iso_9001", "date_of_expiry_iso_9001"]
        ],
        [
            "iso_14001",
            "date_of_expiry_iso_14001",
            ["attach_certificate_iso_14001", "date_of_registration_iso_14001", "date_of_expiry_iso_14001"]
        ],
        [
            "iso_45001",
            "date_of_expiry_iso_45001",
            ["attach_certificate_iso_45001", "date_of_registration__iso_45001", "date_of_expiry_iso_45001"]
        ],
        [
            "iso_50001",
            "date_of_expiry_iso_50001",
            ["date_of_registration_iso_50001", "date_of_expiry_iso_50001"]
        ],
        [
            "other_standard",
            "date_of_expiry",
            ["attach_certificate", "other_standards", "date_of_registration", "date_of_expiry"]
        ],
    ];

    cert_blocks.forEach(([checkbox_field, expiry_field, fields_to_lock]) => {
        let should_lock = 0;

        if (frm.doc[checkbox_field] && frm.doc[expiry_field]) {
            // Locked while certificate is still valid: today <= expiry
            should_lock = today <= frm.doc[expiry_field] ? 1 : 0;
        }

        fields_to_lock.forEach(fieldname => {
            frm.set_df_property(fieldname, "read_only", should_lock);
        });
    });

    frm.refresh_fields();
}

// Checks the relevant checklist child table for a row matching the requirement label,
// and returns true only if that row is marked "Yes" and has an attachment uploaded.
function has_attachment_for_requirement(frm, table_fieldname, requirement_label) {
    let rows = frm.doc[table_fieldname] || [];
    let row = rows.find(r => r.requirement__document === requirement_label);
    return !!(row && row.attachment);
}

function calculate_legal_registration_score(frm) {
    if (!frm.doc.supplier_type) return;

    let score = 0;

    if (frm.doc.supplier_type === "Domestic") {
        // field -> corresponding checklist requirement label
        let checks = [
            { field: frm.doc.gst_no, label: "GST Certificate" },
            { field: frm.doc.pan_no, label: "PAN Card" }
        ];

        checks.forEach(c => {
            if (c.field) {
                let has_attachment = has_attachment_for_requirement(
                    frm, "domestic_supplier_document_checklist", c.label
                );
                let this_score = has_attachment ? 3 : 2;
                score = Math.max(score, this_score);
            }
        });
    } else if (frm.doc.supplier_type === "International") {
        if (frm.doc.taxpayer_identification_no__vat_id__ein) {
            let has_attachment = has_attachment_for_requirement(
                frm, "international_supplier_document_checklist", "Taxpayer Identification Certificate"
            );
            score = has_attachment ? 3 : 2;
        }
    }

    set_evaluation_score(frm, "Company Legally Registered", score);
}


function calculate_years_in_business_score(frm) {
    let score = frm.doc.year_established ? 3 : 0;
    set_evaluation_score(frm, "Years in Business", score);
}

function calculate_production_capacity_score(frm) {
    let score = (frm.doc.production_capacity_suitable_for_our_demand && frm.doc.production_capacity_details) ? 3 : 0;
    set_evaluation_score(frm, "Production Capacity Suitable For Our Demand", score);
}

function calculate_quality_management_score(frm) {
    let iso_checked = !!frm.doc.iso_9001;
    let iatf_checked = !!frm.doc.iatf_16949;

    let score = 0;

    if (iso_checked || iatf_checked) {
        // Default to 2 whenever at least one certification is checked
        score = 2;

        if (iso_checked && iatf_checked) {
            let iso_attached = !!frm.doc.attach_certificate_iso_9001;
            let iatf_attached = !!frm.doc.attach_certificate_iatf_16949;

            if (iso_attached && iatf_attached) {
                score = 3; // both checked, both attached
            } else {
                score = 2; // both checked, 0 or 1 attachment
            }
        }
    }

    set_evaluation_score(frm, "Quality Management System (ISO 9001 / IATF 16949)", score);
}

// Generic handler for simple checkbox -> criteria mappings (checked = 3, unchecked = 0)
function calculate_simple_checkbox_score(frm, fieldname, criteria_label) {
    let score = frm.doc[fieldname] ? 3 : 0;
    set_evaluation_score(frm, criteria_label, score);
}

// Generic handler for checkbox + matching attachment field:
// unchecked = 0, checked without attachment = 2, checked with attachment = 3
function calculate_checkbox_with_attachment_score(frm, checkbox_fieldname, attach_fieldname, criteria_label) {
    let checked = !!frm.doc[checkbox_fieldname];
    let attached = !!frm.doc[attach_fieldname];

    let score = 0;
    if (checked) {
        score = attached ? 3 : 2;
    }

    set_evaluation_score(frm, criteria_label, score);
}

// ESG / Sustainability / GHG Reporting:
// esg__sustainability__ghg_reporting (Select: Yes/No/Not Applicable) = "Yes" -> 2
// "Yes" + esg__sustainability_ghg_reporting (Attach) present -> 3
// otherwise -> 0
function calculate_ghg_accounting_score(frm) {
    let is_yes = frm.doc.esg__sustainability__ghg_reporting === "Yes";
    let attached = !!frm.doc.esg__sustainability_ghg_reporting;

    let score = 0;
    if (is_yes) {
        score = attached ? 3 : 2;
    }

    set_evaluation_score(frm, "GHG Accounting", score);
}

// Financial Stability:
// ratio = (Working Capital / Turnover) * 100
// ratio < 0        -> score 0
// 0 <= ratio <= 5   -> score 1
// 5 < ratio <= 10   -> score 2
// ratio > 10        -> score 3
function calculate_financial_stability_score(frm) {
    let working_capital = frm.doc.working__capital;
    let turnover = frm.doc.turnover;

    // Can't compute without a non-zero turnover
    if (!turnover) {
        set_evaluation_score(frm, "Financial Stability", 0);
        return;
    }

    let ratio = (working_capital / turnover) * 100;

    let score = 0;
    if (ratio < 0) {
        score = 0;
    } else if (ratio <= 5) {
        score = 1;
    } else if (ratio <= 10) {
        score = 2;
    } else {
        score = 3;
    }

    set_evaluation_score(frm, "Financial Stability", score);
}

function set_evaluation_score(frm, criteria_label, score) {
    let row = (frm.doc.supplier_risk_assessment_matrix || []).find(
        r => r.evaluation_criteria === criteria_label
    );

    if (!row) {
        row = frm.add_child("supplier_risk_assessment_matrix");
        row.evaluation_criteria = criteria_label;
    }

    // Weight % = Score / 3 * 100
    let weight = (score / 3) * 100;

    // Weighted Score = Weight % x Score / 3
    let weighted_score = (weight * score) / 3;

    frappe.model.set_value(row.doctype, row.name, "score_15", score ? String(score) : "");
    frappe.model.set_value(row.doctype, row.name, "weight_", weight);
    frappe.model.set_value(row.doctype, row.name, "weighted_score", weighted_score);

    frm.refresh_field("supplier_risk_assessment_matrix");
}

function set_evaluation_score(frm, criteria_label, score) {
    let row = (frm.doc.supplier_risk_assessment_matrix || []).find(
        r => r.evaluation_criteria === criteria_label
    );

    if (!row) {
        row = frm.add_child("supplier_risk_assessment_matrix");
        row.evaluation_criteria = criteria_label;
    }

    // Weight % = Score / 3 * 100
    let weight = (score / 3) * 100;

    // Weighted Score = Weight % × Score / 3
    let weighted_score = (weight * score) / 3;

    frappe.model.set_value(row.doctype, row.name, "score_15", score);
    frappe.model.set_value(row.doctype, row.name, "weight_", weight);
    frappe.model.set_value(row.doctype, row.name, "weighted_score", weighted_score);

    frm.refresh_field("supplier_risk_assessment_matrix");

    // Recalculate totals
    calculate_totals(frm);
}

function calculate_totals(frm) {
    let rows = frm.doc.supplier_risk_assessment_matrix || [];

    // Sum of earned scores
    let total_score_earn = rows.reduce((sum, row) => {
        return sum + (flt(row.score_15) || 0);
    }, 0);

    // Maximum possible score (3 per row)
    let total_score = rows.length * 3;

    frm.set_value("total_score", total_score);
    frm.set_value("total_score_earn", total_score_earn);
}