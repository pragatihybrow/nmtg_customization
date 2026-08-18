// Copyright (c) 2026, Hybrowlabs and contributors
// For license information, please see license.txt
frappe.ui.form.on("Feasibility Review Report", {
    onload: function(frm) {
        if (frm.is_new() && !frm.doc.prepared_by) {
            frm.set_value("prepared_by", frappe.session.user);
        }

        if (frm.is_new() && (!frm.doc.feasibility_checkpoints || frm.doc.feasibility_checkpoints.length === 0)) {
            const categories = [
                "Technical Capability",
                "Infrastructure Feasibility",
                "Existing Work Load Vs Time Line",
                "Staff",
                "Budgets & Financial Matters",
                "Other",
                "Statutory & Regulatory Requirements"
            ];

            categories.forEach(cat => {
                let row = frm.add_child("feasibility_checkpoints");
                row.category = cat;
            });

            frm.refresh_field("feasibility_checkpoints");
        }
    }
});