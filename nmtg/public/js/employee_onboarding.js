frappe.ui.form.on('Employee Onboarding', {
    refresh(frm) {
        setTimeout(() => {
            frm.remove_custom_button('Employee', 'Create');
            // If it's the only item, remove the empty Create group too:
            frm.page.remove_inner_button('Create');
        }, 300);
    }
});