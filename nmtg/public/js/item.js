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
        // Clear all dependent fields when Item Group changes
        frm.set_value("custom_product_group", "");
        frm.set_value("custom_sub_product_group", "");
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
    },

    custom_product_group: function(frm) {
        // Clear dependent fields when Product Group changes
        frm.set_value("custom_sub_product_group", "");
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
    },

    custom_sub_product_group: function(frm) {
        // Clear models when Sub Product Group changes
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
    if (frm.doc.custom_sub_product_group) {
        frm.set_query("custom_models", function() {
            return {
                filters: {
                    parent_item_group: frm.doc.custom_sub_product_group
                }
            };
        });
    } else {
        frm.set_query("custom_models", function() {
            return {
                filters: {
                    parent_item_group: ""
                }
            };
        });
    }
}