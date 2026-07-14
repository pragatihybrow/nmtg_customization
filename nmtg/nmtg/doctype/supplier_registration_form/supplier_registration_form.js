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
    }
});

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
            { field: frm.doc.pan_no, label: "PAN Card" },
            { field: frm.doc.vat__tin_no, label: "VAT / TIN No." }
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

function calculate_ghg_accounting_score(frm) {
    let is_yes = frm.doc.esg__sustainability__ghg_reporting === "Yes";
    let attached = !!frm.doc.esg__sustainability_ghg_reporting;

    let score = 0;
    if (is_yes) {
        score = attached ? 3 : 2;
    }

    set_evaluation_score(frm, "GHG Accounting", score);
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