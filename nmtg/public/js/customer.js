frappe.ui.form.on('Customer', {
    custom_customer__type: function(frm) {
        frm.set_value('custom_industrys', []);
        frm.set_value('custom_application', []);
        set_industry_filter(frm);
    },

    custom_industrys: function(frm) {
        frm.set_value('custom_application', []);
        set_application_filter(frm);
    },

    onload: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
    },

    refresh: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
    }
});

function set_industry_filter(frm) {
    const customer_types = (frm.doc.custom_customer__type || [])
        .map(row => row.customer_type)
        .filter(Boolean);

    if (!customer_types.length) {
        frm.set_query('custom_industrys', () => ({ filters: [] }));
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

        frm.set_query('custom_industrys', function() {
            if (!industry_names.length) {
                return { filters: [['name', '=', '__none__']] };
            }
            return { filters: [['name', 'in', industry_names]] };
        });
    });
}

function set_application_filter(frm) {
    const industries = (frm.doc.custom_industrys || [])
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