frappe.ui.form.on("Item Group", {

    custom_level: function(frm) {

        if (frm.doc.custom_level === "Level 1") {
            frm.set_value("custom_item_group_title", "Item Group");

            if (!frm.doc.is_group) {
                frm.set_value("is_group", 1);
            }
        }

        else if (frm.doc.custom_level === "Level 2") {
            frm.set_value("custom_item_group_title", "Product Group");

            if (!frm.doc.is_group) {
                frm.set_value("is_group", 1);
            }
        }

        else if (frm.doc.custom_level === "Level 3") {
            frm.set_value("custom_item_group_title", "Sub-Product Group");
        }
         else if (frm.doc.custom_level === "Level 4") {
            frm.set_value("custom_item_group_title", "Model");
        }
    },
    onload:function(frm){
          if (frm.doc.custom_level === "Level 1") {
            frm.set_value("custom_item_group_title", "Item Group");

            if (!frm.doc.is_group) {
                frm.set_value("is_group", 1);
            }
        }

        else if (frm.doc.custom_level === "Level 2") {
            frm.set_value("custom_item_group_title", "Product Group");

            if (!frm.doc.is_group) {
                frm.set_value("is_group", 1);
            }
        }

        else if (frm.doc.custom_level === "Level 3") {
            frm.set_value("custom_item_group_title", "Sub-Product Group");
        }

        else if (frm.doc.custom_level === "Level 4") {
            frm.set_value("custom_item_group_title", "Model");
        }

    },

    custom_include_models: function(frm) {

        if (frm.doc.custom_include_models) {
            frm.set_value("is_group", 1);
        } else {
            frm.set_value("is_group", 0);
        }
    }
});