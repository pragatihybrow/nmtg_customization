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
    },
});