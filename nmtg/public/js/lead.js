frappe.ui.form.on('Lead', {
    custom_customer_type: function(frm) {
        frm.set_value('custom_industry_ct', []);
        frm.set_value('custom_application', []);
        set_industry_filter(frm);
    },

    custom_industry_ct: function(frm) {
        frm.set_value('custom_application', []);
        set_application_filter(frm);
    },

    onload: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        set_first_row_name(frm);
    },

    refresh: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        set_first_row_name(frm);
    },

    first_name(frm) {
        set_first_row_name(frm);
    },
    company_name(frm) {
        set_first_row_name(frm);
    }
});

function set_industry_filter(frm) {
    const customer_types = (frm.doc.custom_customer_type || [])
        .map(row => row.customer_type)
        .filter(Boolean);

    if (!customer_types.length) {
        frm.set_query('custom_industry_ct', () => ({ filters: [] }));
        return;
    }

    Promise.all(
        customer_types.map(ct =>
            frappe.db.get_doc('Customer Type', ct).catch(() => null)
        )
    ).then(docs => {
        const industry_names = [
            ...new Set(
                docs
                    .filter(Boolean)
                    .flatMap(doc => (doc.industry || []).map(row => row.industry).filter(Boolean))
            )
        ];

        frm.set_query('custom_industry_ct', function() {
            if (!industry_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', industry_names]] };
        });
    });
}

function set_application_filter(frm) {
    const industries = (frm.doc.custom_industry_ct || [])
        .map(row => row.industry)
        .filter(Boolean);

    if (!industries.length) {
        frm.set_query('custom_application', () => ({ filters: [] }));
        return;
    }

    Promise.all(
        industries.map(ind =>
            frappe.db.get_doc('Industry', ind).catch(() => null)
        )
    ).then(docs => {
        const application_names = [
            ...new Set(
                docs
                    .filter(Boolean)
                    .flatMap(doc => (doc.application || []).map(row => row.application).filter(Boolean))
            )
        ];

        frm.set_query('custom_application', function() {
            if (!application_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', application_names]] };
        });
    });
}

function set_first_row_name(frm) {
    let cname = frm.doc.first_name || frm.doc.company_name || '';
    if (!cname) return;

    if (!frm.doc.custom_contact_info || !frm.doc.custom_contact_info.length) {
        let row = frm.add_child('custom_contact_info');
        row.name1 = cname;
    } else {
        let row = frm.doc.custom_contact_info[0];
        // don't clobber a row once it's linked to an actual Contact
        if (row.name1 !== cname && !row.custom_contact_ref) {
            frappe.model.set_value(row.doctype, row.name, 'name1', cname);
        }
    }
    frm.refresh_field('custom_contact_info');
}

frappe.ui.form.on('Lead Contact Info', {
    email_id(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    contact_no(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    whatsapp_no(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    designation(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); },
    name1(frm, cdt, cdn) { debounced_sync_contact(frm, cdt, cdn); }
});

const debounced_sync_contact = frappe.utils.debounce(sync_contact, 800);

function sync_contact(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!row.name1) return;
    if (!row.email_id && !row.contact_no && !row.whatsapp_no) return;

    frappe.call({
        method: "nmtg.override.api.create_or_update_lead_contact",
        args: {
            row: row,
            lead: frm.doc.name
        },
        callback: function (r) {
            if (r.message) {
                frappe.model.set_value(cdt, cdn, 'custom_contact_ref', r.message);
            }

            // Contact sync may have silently updated the Lead's `modified`
            // timestamp server-side (core Contact->Lead sync hook).
            // Refresh just that timestamp so the next Save doesn't conflict.
            frappe.call({
                method: 'frappe.client.get_value',
                args: {
                    doctype: 'Lead',
                    filters: frm.doc.name,
                    fieldname: 'modified'
                },
                callback: function (res) {
                    if (res.message && res.message.modified) {
                        frm.doc.modified = res.message.modified;
                    }
                }
            });
        }
    });
}