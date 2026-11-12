frappe.ui.form.on('Interview Feedback', {
    validate: function(frm) {

        let total_weightage = 0;

        (frm.doc.skill_assessment || []).forEach(row => {
            total_weightage += flt(row.weightage);
        });

        total_weightage = flt(total_weightage, 2);

        if (total_weightage !== 100) {
            frappe.throw(
                __('Total Skill Assessment Weightage must be exactly 100%. Current total: {0}%', 
                [total_weightage])
            );
        }
    }
});