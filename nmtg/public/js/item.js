let item_settings_cache = null;

frappe.ui.form.on("Item", {
    onload: function(frm) { 
        item_settings_cache = null; // fresh fetch on load
        toggle_models_field(frm);
        apply_item_settings_fields(frm);
        set_models_filter(frm);
         if (frm.is_new()) {
            frm.doc.item_code = "TEMP-" + frappe.utils.get_random(8);
            frm.doc.item_name = "";
        }
    },
    refresh: function(frm) { 
        toggle_models_field(frm);
        set_models_filter(frm);
        apply_item_settings_fields(frm);
       // generate_item_name(frm)
    },

    item_group: function(frm) {
        frm.set_value("custom_product_group", "");
        frm.set_value("custom_sub_product_group", "");
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
        apply_item_settings_fields(frm);
       // generate_item_name(frm)
    },

    custom_product_group: function(frm) {
        frm.set_value("custom_sub_product_group", "");
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
        apply_item_settings_fields(frm);
       // generate_item_name(frm);
    },

    custom_sub_product_group: function(frm) {
        frm.set_value("custom_models", []);
        toggle_models_field(frm);
        set_models_filter(frm);
        apply_item_settings_fields(frm);
        // generate_item_code(frm);
    },

    custom_id: function(frm) {
        set_actual_size(frm);
    },

    custom_od: function(frm) {
        set_actual_size(frm);
    },

    custom_tl: function(frm) {
        set_actual_size(frm);
    },
    custom_id_uom: function(frm) {
        set_actual_size(frm);
    },
    custom_od_uom: function(frm) {
        set_actual_size(frm);
    },
    custom_total_length_uom: function(frm) {
        set_actual_size(frm);
    },

    custom_material_type(frm) {

        frm.set_value("custom_material_sub_type", "");

        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Material Type",
                name: frm.doc.custom_material_type
            },
            callback: function(r) {

                if (r.message) {

                    let sub_types = r.message.material_sub_type.map(
                        row => row.material_sub_type
                    );

                    frm.set_query("custom_material_sub_type", function() {
                        return {
                            filters: [
                                ["Material Sub Type", "name", "in", sub_types]
                            ]
                        };
                    });

                }
            }
        });

        // Re-evaluate visible fields now that material type changed
        apply_item_settings_fields(frm);
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

function generate_item_name(frm) {

    let item_group = frm.doc.item_group || "";
    let model = frm.doc.custom_sub_product_group || "";
    let uom = frm.doc.stock_uom || "";

    let thread_diameter = frm.doc.custom_thread_diameter || "";
    let pitch = frm.doc.custom_pitch_ || "";

    // Actual Size Example:
    // 17X47X20
    let actual_size = frm.doc.custom_actual_size || "";

    let item_name = "";

    // Threaded Items
    if (uom === "Inches" || uom === "MM") {

        // Remove existing M/P if present
        let diameter = thread_diameter.toString()
            .replace(/M/gi, "")
            .trim();

        let pitchValue = pitch.toString()
            .replace(/P/gi, "")
            .trim();

        // Apply standard format
        item_name = `${model} - M${diameter} x ${pitchValue}P`;
    }

    else {

        let formatted_size = actual_size;
        if (actual_size) {

            // Support both X and x
            let normalized_size = actual_size.replace(/x/g, "X");

            let parts = normalized_size.split("X");

            if (parts.length >= 3) {

                let id = parts[0].trim();
                let od = parts[1].trim();
                let tl = parts[2].trim();

                formatted_size =
                    `ID ${id} mm x OD ${od} mm x TL ${tl} mm`;
            }
        }

        // Finished Goods
        if (item_group === "Finished Goods") {

            item_name =
                `FG ${model} - ${formatted_size}`;
        }

        // Other Components
        else {

            item_name =
                `${model} - ${formatted_size}`;
        }
    }

    frm.set_value("item_name", item_name.trim());
}

function generate_item_code(frm) {

    const prefix = "N";
    const group_initials = frm.doc.custom_product_group_initials || "";
    const product_code = frm.doc.custom_product_code || "";

    if (!group_initials || !product_code) {
        return;
    }

    const base_code = `${prefix}${group_initials}${product_code}`;

    frappe.db.get_list("Item", {
        filters: {
            item_code: ["like", `${base_code}%`]
        },
        fields: ["item_code"],
        limit: 1000
    }).then((items) => {

        let max_sequence = 0;

        items.forEach(item => {

            let code = item.item_code || "";

            // Extract numeric part after base code
            let sequence_part = code.replace(base_code, "");

            let number = parseInt(sequence_part, 10);

            if (!isNaN(number) && number > max_sequence) {
                max_sequence = number;
            }
        });

        let next_sequence = max_sequence + 1;

        let padded_sequence = String(next_sequence).padStart(5, "0");

        let item_code = `${base_code}${padded_sequence}`;

        frm.set_value("item_code", item_code);
    });
}

function set_actual_size(frm) {
    let id = frm.doc.custom_id || "";
    let od = frm.doc.custom_od || "";
    let tl = frm.doc.custom_tl || "";
    let id_uom = frm.doc.custom_id_uom || "";
    let od_uom = frm.doc.custom_od_uom || "";
    let tl_uom = frm.doc.custom_total_length_uom || "";



    if (id && od && tl) {
        frm.set_value(
            "custom_actual_size",
            `${id}${id_uom} x ${od}${od_uom} x ${tl}${tl_uom}`
        );
    } else {
        frm.set_value("custom_actual_size", "");
    }
}

function get_item_settings(callback) {
    if (item_settings_cache) {
        callback(item_settings_cache);
        return;
    }
    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Item Settings",
            name: "Item Settings"
        },
        callback: function(r) {
            if (r.message) {
                item_settings_cache = r.message;
                callback(item_settings_cache);
            }
        }
    });
}

function apply_item_settings_fields(frm) {

    // Fields always visible
    let always_visible = [
        "custom_product_group",
        "custom_product_group_initials",
        "custom_sub_product_group",
        "custom_product_code",
        "custom_models",
        "custom_material_type",
        "custom_material_sub_type",
        "custom_section_break_0x4t9",
        "custom_section_break_qnbdu",
        "gst_hsn_code",
        "is_ineligible_for_itc",
        "custom_quality_inspection_percent",
        "custom_column_break_uehck",
        "custom_drawing",
        "custom_tds_attachment",
        "custom_formula_for_conversion",
        "custom_only_internal_qc",
        "custom_create_nmtg_code",
        "custom_legacy_item_name",
        "custom_quality_category_required"
    ];

    // Show always_visible fields, hide every other dynamic custom field
    frm.meta.fields.forEach(df => {
        if (df.fieldname && df.fieldname.startsWith("custom_")) {
            if (always_visible.includes(df.fieldname)) {
                frm.set_df_property(df.fieldname, "hidden", 0);
            } else {
                frm.set_df_property(df.fieldname, "hidden", 1);
            }
        }
    });

    get_item_settings(function(settings_doc) {

        let settings = settings_doc.item_settings || [];

        let matched_row = settings.find(row => {
            return (
                row.item_group === frm.doc.item_group &&
                row.product_group === frm.doc.custom_product_group &&
                row.sub_product_group === frm.doc.custom_sub_product_group &&
                (!row.material_type || row.material_type === frm.doc.custom_material_type)
            );
        });

        if (matched_row && matched_row.feilds) {
            matched_row.feilds.split(",").forEach(field => {
                frm.set_df_property(field.trim(), "hidden", 0);
            });
        }

        frm.refresh_fields();
    });
}