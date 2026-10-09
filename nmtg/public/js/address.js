frappe.ui.form.on("Address", {
    refresh: function(frm) {
        frm.__loaded_state = frm.doc.state || "";
    },

    before_save: function(frm) {
        set_state_in_address_title(frm);
    }
});

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