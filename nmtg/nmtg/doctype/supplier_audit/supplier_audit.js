// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt

const AUDIT_REQUIREMENTS = [
    "Organization structure defined",
    "Roles & responsibilities documented",
    "Quality objectives established and monitored",
    "Management review conducted periodically",
    "Business continuity plan available",
    "ISO 9001/ IATF 16949 certification available",
    "Document control implemented",
    "Record control implemented",
    "Internal audit conducted",
    "Corrective action (CAPA) system effective",
    "Customer complaint management implemented",
    "Customer requirements reviewed before acceptance",
    "Customer-specific requirements identified",
    "Engineering changes controlled",
    "Customer communication process established",
    "APQP activities implemented",
    "PFMEA available and maintained",
    "Control Plan available",
    "PPAP available as applicable",
    "Special characteristics identified and controlled",
    "Process flow available",
    "Work instructions available at workplace",
    "Operators trained and competent",
    "Process parameters monitored",
    "Reaction plan available for nonconformities",
    "Product traceability maintained",
    "Incoming inspection implemented",
    "In-process inspection implemented",
    "Final inspection implemented",
    "Measuring equipment calibrated",
    "MSA implemented",
    "SPC implemented",
    "Production planning system effective",
    "Preventive maintenance implemented",
    "Machine breakdown monitored",
    "Capacity planning performed",
    "5S/ workplace organization maintained",
    "Approved supplier list maintained",
    "Incoming supplier evaluation performed",
    "Supplier performance monitored",
];

const MAX_SCORE_PER_ROW = 3;

frappe.ui.form.on("Supplier Audit", {
    refresh(frm) {
        frm.fields_dict.criteria.$wrapper.html(`
            <div style="display:flex; flex-direction:row; justify-content:center; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                <img
                    src="/files/Screenshot from 2026-07-15 12-29-16.png"
                    style="max-width:49%; height:auto; border-radius:4px;"
                >
                <img
                    src="/files/Screenshot from 2026-07-15 12-29-53.png"
                    style="max-width:49%; height:auto; border-radius:4px;"
                >
            </div>
        `);

        if (frm.is_new() && (!frm.doc.supplier_audit_checksheet || frm.doc.supplier_audit_checksheet.length === 0)) {
            AUDIT_REQUIREMENTS.forEach((requirement) => {
                let row = frm.add_child("supplier_audit_checksheet", {
                    audit_requirement: requirement,
                });
            });
            frm.refresh_field("supplier_audit_checksheet");
            calculate_scores(frm);
        }
    },
});

frappe.ui.form.on("Supplier Audit CT", {
    score(frm, cdt, cdn) {
        calculate_scores(frm);
    },
    supplier_audit_checksheet_remove(frm) {
        calculate_scores(frm);
    },
});

function calculate_scores(frm) {
    let maximum_score = 0;
    let achieved_score = 0;

    (frm.doc.supplier_audit_checksheet || []).forEach((row) => {
        if (row.score === "NA") {
            // NA rows are excluded from both maximum and achieved totals
            return;
        }
        maximum_score += MAX_SCORE_PER_ROW;
        if (row.score !== undefined && row.score !== null && row.score !== "") {
            achieved_score += flt(row.score);
        }
    });

    let score_percent = maximum_score > 0 ? flt((achieved_score / maximum_score) * 100, 2) : 0;

    frm.set_value("maximum_score", maximum_score);
    frm.set_value("achieved_score", achieved_score);
    frm.set_value("score_", score_percent);

    set_risk_level(frm, score_percent);
}

function set_risk_level(frm, score_percent) {
    let risk_level = "";
    if (score_percent >= 90) {
        risk_level = "Excellent-Approved";
    } else if (score_percent >= 80) {
        risk_level = "Good-Approved";
    } else if (score_percent >= 70) {
        risk_level = "Acceptable-Approved with Improvement Plan";
    } else if (score_percent >= 60) {
        risk_level = "High Risk\t-Conditional Approval";
    } else {
        risk_level = "Very High Risk-Re-Audit Required";
    }
    frm.set_value("risk_level", risk_level);
}