frappe.ui.form.on("Item", {
    onload: function(frm) { 
        toggle_models_field(frm);
        set_models_filter(frm);
    },
    refresh: function(frm) { 
        toggle_models_field(frm);
        set_models_filter(frm);
    },

    item_group: function(frm) {
        frm.set_value("custom_product_group", "");
        frm.set_value("custom_sub_product_group", "");
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
    },

    custom_product_group: function(frm) {
        frm.set_value("custom_sub_product_group", "");
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
    },

    custom_sub_product_group: function(frm) {
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
    }
});

function toggle_models_field(frm) {
    if (frm.doc.custom_sub_product_group) {
        frappe.db.get_value(
            "Item Group",
            frm.doc.custom_sub_product_group,
            "custom_include_models",
            function(value) {
                frm.set_df_property(
                    "custom_models",
                    "hidden",
                    value.custom_include_models ? 0 : 1
                );
            }
        );
    } else {
        frm.set_df_property("custom_models", "hidden", 1);
    }
}

function set_models_filter(frm) {
    if (!frm.doc.custom_sub_product_group) {
        // Block all when no sub product group selected
        frm.set_query("custom_models", function() {
            return {
                filters: [["Model", "name", "=", "__no_match__"]]
            };
        });
        return;
    }

    frappe.db.get_doc("Item Group", frm.doc.custom_sub_product_group)
        .then(function(doc) {
            const model_names = (doc.custom_model || [])
                .map(row => row.model)
                .filter(Boolean);

            // For Table MultiSelect, set_query uses the fieldname directly
            frm.set_query("custom_models", function() {
                return {
                    filters: [
                        ["Model", "name", "in", model_names.length ? model_names : ["__no_match__"]]
                    ]
                };
            });
        });
}