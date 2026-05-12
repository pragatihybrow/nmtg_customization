

frappe.ui.form.on('Item', {
    custom_customer_type: function(frm) {
        frm.set_value('custom_industry', []);
        frm.set_value('custom_application', []);
        set_industry_filter(frm);
    },

    custom_industry: function(frm) {
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
    const customer_types = (frm.doc.custom_customer_type || [])
        .map(row => row.customer_type)
        .filter(Boolean);

    if (!customer_types.length) {
        frm.set_query('custom_industry', () => ({ filters: [] }));
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

        frm.set_query('custom_industry', function() {
            if (!industry_names.length) {
                return {
                    filters: [['name', '=', '__none__']]
                };
            }
            return {
                filters: [['name', 'in', industry_names]]
            };
        });
    });
}

function set_application_filter(frm) {
    const industries = (frm.doc.custom_industry || [])
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
                return {
                    filters: [['name', '=', '__none__']]
                };
            }
            return {
                filters: [['name', 'in', application_names]]
            };
        });
    });
}

// frappe.ui.form.on('Item', {
//     custom_customer_type: function(frm) {
//         // Clear industry when customer type changes
//         frm.set_value('custom_industry', '');
        
//         set_industry_filter(frm);
//     },
    
//     onload: function(frm) {
//         set_industry_filter(frm);
//         set_application_filter(frm);

//     },
    
//     refresh: function(frm) {
//         set_industry_filter(frm);
//         set_application_filter(frm);

//     },
//     custom_industry: function(frm) {
//         // Clear industry when customer type changes
//         frm.set_value('custom_application', '');
        
//         set_application_filter(frm);
//     },
// });

// function set_industry_filter(frm) {
//     const customer_type = frm.doc.custom_customer_type;
    
//     if (!customer_type) {
//         // No filter — show all industries
//         frm.set_query('custom_industry', function() {
//             return { filters: [] };
//         });
//         return;
//     }
    
//     // Fetch the industries linked in this Customer Type's child table
//     frappe.db.get_doc('Customer Type', customer_type).then(doc => {
//         const industry_names = (doc.industry || []).map(row => row.industry).filter(Boolean);
        
//         if (industry_names.length === 0) {
//             frm.set_query('custom_industry', function() {
//                 return { filters: [['Industry', 'name', '=', '']] }; // No valid options
//             });
//             return;
//         }
        
//         frm.set_query('custom_industry', function() {
//             return {
//                 filters: [
//                     ['Industry', 'name', 'in', industry_names]
//                 ]
//             };
//         });
//     });
// }


// function set_application_filter(frm) {
//     const industry = frm.doc.custom_industry;
    
//     if (!industry) {
//         // No filter — show all industries
//         frm.set_query('custom_application', function() {
//             return { filters: [] };
//         });
//         return;
//     }
    
//     // Fetch the industries linked in this Customer Type's child table
//     frappe.db.get_doc('Industry', industry).then(doc => {
//         const application_names = (doc.application || []).map(row => row.application).filter(Boolean);
        
//         if (application_names.length === 0) {
//             frm.set_query('custom_application', function() {
//                 return { filters: [['Application', 'name', '=', '']] }; // No valid options
//             });
//             return;
//         }
        
//         frm.set_query('custom_application', function() {
//             return {
//                 filters: [
//                     ['Application', 'name', 'in', application_names]
//                 ]
//             };
//         });
//     });
// }