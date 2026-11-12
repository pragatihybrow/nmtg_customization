frappe.ui.form.on("Address", {
    refresh: function(frm) {
        frm.__loaded_state = frm.doc.state || "";

        if (frm.is_new()) {
            fetch_company_from_lead(frm);
        }
    },

    before_save: function(frm) {
        set_state_in_address_title(frm);
    }
});

frappe.ui.form.on("Dynamic Link", {
    link_doctype: function(frm, cdt, cdn) {
        if (frm.is_new()) fetch_company_from_lead(frm, true);
    },
    link_name: function(frm, cdt, cdn) {
        if (frm.is_new()) fetch_company_from_lead(frm, true);
    }
});

function fetch_company_from_lead(frm, force) {
    if (frm.__company_fetched && !force) return;

    const row = (frm.doc.links || []).find(
        (d) => d.link_doctype === "Lead" && d.link_name
    );
    if (!row) return;

    frappe.db.get_value("Lead", row.link_name, ["company_name", "lead_name"]).then((r) => {
        const v = r.message || {};
        const company = (v.company_name || v.lead_name || "").trim();
        if (!company) return;

        frm.__company_fetched = true;
        frm.set_value("address_title", company);
    });
}

function set_state_in_address_title(frm) {
    const state = (frm.doc.state || "").trim();
    if (!state) return;

    let title = (frm.doc.address_title || "").trim();
    if (!title) return;

    const old_state = (frm.__loaded_state || "").trim();
    if (old_state) {
        const old_suffix = ` - ${old_state}`;
        if (title.endsWith(old_suffix)) {
            title = title.slice(0, -old_suffix.length).trim();
        }
    }

    const suffix = ` - ${state}`;
    if (!title.endsWith(suffix)) {
        title = title + suffix;
    }

    frm.doc.address_title = title;
    frm.refresh_field("address_title");
}