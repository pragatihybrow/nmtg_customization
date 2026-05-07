

frappe.ui.form.on('Item', {
    custom_customer_type: function(frm) {
        // Clear industry when customer type changes
        frm.set_value('custom_industry', '');
        
        set_industry_filter(frm);
    },
    
    onload: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);

    },
    
    refresh: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);

    },
    custom_industry: function(frm) {
        // Clear industry when customer type changes
        frm.set_value('custom_application', '');
        
        set_application_filter(frm);
    },
});

function set_industry_filter(frm) {
    const customer_type = frm.doc.custom_customer_type;
    
    if (!customer_type) {
        // No filter — show all industries
        frm.set_query('custom_industry', function() {
            return { filters: [] };
        });
        return;
    }
    
    // Fetch the industries linked in this Customer Type's child table
    frappe.db.get_doc('Customer Type', customer_type).then(doc => {
        const industry_names = (doc.industry || []).map(row => row.industry).filter(Boolean);
        
        if (industry_names.length === 0) {
            frm.set_query('custom_industry', function() {
                return { filters: [['Industry', 'name', '=', '']] }; // No valid options
            });
            return;
        }
        
        frm.set_query('custom_industry', function() {
            return {
                filters: [
                    ['Industry', 'name', 'in', industry_names]
                ]
            };
        });
    });
}


function set_application_filter(frm) {
    const industry = frm.doc.custom_industry;
    
    if (!industry) {
        // No filter — show all industries
        frm.set_query('custom_application', function() {
            return { filters: [] };
        });
        return;
    }
    
    // Fetch the industries linked in this Customer Type's child table
    frappe.db.get_doc('Industry', industry).then(doc => {
        const application_names = (doc.application || []).map(row => row.application).filter(Boolean);
        
        if (application_names.length === 0) {
            frm.set_query('custom_application', function() {
                return { filters: [['Application', 'name', '=', '']] }; // No valid options
            });
            return;
        }
        
        frm.set_query('custom_application', function() {
            return {
                filters: [
                    ['Application', 'name', 'in', application_names]
                ]
            };
        });
    });
}