frappe.ui.form.on('Employee', {
    refresh(frm) {
        if (frm.fields_dict.custom_digital_sign_preview) {
            const wrapper = frm.fields_dict.custom_digital_sign_preview.$wrapper;
            wrapper.empty();

            if (frm.doc.custom_digital_sign) {
                const img = $('<img>')
                    .attr('src', frm.doc.custom_digital_sign)
                    .css({
                        'max-width': '300px',
                        'max-height': '150px',
                        'object-fit': 'contain',
                        'border': '1px solid #ddd',
                        'padding': '5px'
                    });

                wrapper.append(img);
            }
        }
    }
});