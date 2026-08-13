// // Copyright (c) 2026, Hybrowlabs and contributors
// // For license information, please see license.txt

frappe.ui.form.on("Technical Evaluation Item", {
    // Fires when a grid row is expanded/opened
    form_render(frm, cdt, cdn) {
        set_competitor_model_options(frm, cdt, cdn);
    },

    product_group(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        row.nmtg_model = "";
        row.competitor_model = "";
        refresh_field("nmtg_model", cdn, row.parentfield);
        refresh_field("competitor_model", cdn, row.parentfield);
        set_competitor_model_options(frm, cdt, cdn);
    },

    nmtg_model(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        row.competitor_model = "";
        refresh_field("competitor_model", cdn, row.parentfield);
        set_competitor_model_options(frm, cdt, cdn);
    },

    // fires for every existing row when the child table is rendered (e.g. on form load)
    items_render(frm, cdt, cdn) {
        set_competitor_model_options(frm, cdt, cdn);
    }
});

// on initial parent form load/refresh, set options for all existing rows
frappe.ui.form.on(cur_frm ? cur_frm.doctype : "Technical Evaluation", {
    refresh(frm) {
        (frm.doc.items || []).forEach(row => {
            set_competitor_model_options(frm, row.doctype, row.name);
        });
    }
});

function set_competitor_model_options(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.product_group) return;

    frappe.db.get_doc("Product Group", row.product_group).then(pg_doc => {
        let options = [""];

        (pg_doc.competitor_model || []).forEach(r => {
            // must match same product group (already guaranteed by pg_doc) and same model
            if (row.nmtg_model && r.model !== row.nmtg_model) return;
            if (r.competitor_model_name && !options.includes(r.competitor_model_name)) {
                options.push(r.competitor_model_name);
            }
        });
        let options_str = options.join("\n");

        let grid = frm.fields_dict[row.parentfield].grid;
        let grid_row = grid.grid_rows_by_docname[cdn];
        if (!grid_row) return;

        // 1. update the row's own docfield definition
        let docfield = grid_row.docfields.find(df => df.fieldname === "competitor_model");
        if (docfield) docfield.options = options_str;

        // 2. update the grid-level column template (governs newly created inline cell editors)
        let grid_field = grid.get_field("competitor_model");
        if (grid_field && grid_field.df) grid_field.df.options = options_str;

        // 3. force the INLINE cell control (the dropdown that opens directly on click) to rebuild
        if (grid_row.refresh_field) {
            grid_row.refresh_field("competitor_model");
        } else if (grid_row.columns && grid_row.columns["competitor_model"]) {
            // fallback for older frappe versions without refresh_field
            grid_row.columns["competitor_model"].df.options = options_str;
            grid_row.columns["competitor_model"].field &&
                grid_row.columns["competitor_model"].field.set_options &&
                grid_row.columns["competitor_model"].field.set_options(options_str);
        }

        // 4. if the expanded row-form is open, refresh that field too
        if (grid_row.grid_form && grid_row.grid_form.fields_dict.competitor_model) {
            grid_row.grid_form.fields_dict.competitor_model.df.options = options_str;
            grid_row.grid_form.fields_dict.competitor_model.refresh();
        }
    });
}