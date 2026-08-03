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
        render_product_checkboxes(frm);
    },

    refresh: function(frm) {
        set_industry_filter(frm);
        set_application_filter(frm);
        render_product_checkboxes(frm);
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



const PRODUCT_OPTIONS = [
    "Locking Assembly",
    "Shrink Disc",
    "Tensioner Nut (Hydraulic)",
    "Tensioner Nut (Mechanical)",
    "Tensioner Bolt & Stud Set",
    "One Way Clutch / Freewheel (Standard)",
    "Holdback / Backstop (Mounted)",
    "Overrunning Clutch (Industrial)",
    "Hydraulic Turning Motor with Overrunning Clutch",
    "Clamping Sleeve",
    "Keyless Rigid Coupling"
];



function render_product_checkboxes(frm) {
    const wrapper = frm.fields_dict.custom_product.$wrapper;
    wrapper.empty();

    const selected = (frm.doc.custom_product_ct || "")
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);

    const $container = $('<div class="product-checkbox-group" style="display:flex;flex-wrap:wrap;gap:8px 24px;"></div>').appendTo(wrapper);

    PRODUCT_OPTIONS.forEach((option, idx) => {
        const checkbox_id = `custom_product_${idx}`;
        const is_checked = selected.includes(option);

        const $item = $(`
            <div class="checkbox" style="flex:0 0 45%;">
                <label style="font-weight:normal;">
                    <input type="checkbox" id="${checkbox_id}" data-value="${frappe.utils.escape_html(option)}" ${is_checked ? "checked" : ""}>
                    ${frappe.utils.escape_html(option)}
                </label>
            </div>
        `).appendTo($container);

        $item.find("input").on("change", () => sync_product_ct(frm));
    });
}

function sync_product_ct(frm) {
    const wrapper = frm.fields_dict.custom_product.$wrapper;
    const checked_values = [];

    wrapper.find('input[type="checkbox"]:checked').each(function () {
        checked_values.push($(this).data("value"));
    });

    frm.set_value("custom_product_ct", checked_values.join(", "));
}