frappe.ui.form.on("Leave Application", {
    refresh(frm) {
        show_short_leave_balance(frm);
    },

    employee(frm) {
        show_short_leave_balance(frm);
    },

    from_date(frm) {
        show_short_leave_balance(frm);
    },

    leave_type(frm) {
        show_short_leave_balance(frm);
        if (frm.doc.leave_type !== "Short Leave") {
            frm.set_value({ custom_from_hours: null, custom_to_hours: null });
        } else {
            set_short_leave_days(frm);
        }
    },

    custom_from_hours(frm) {
        set_short_leave_days(frm);
    },

    custom_to_hours(frm) {
        set_short_leave_days(frm);
    },

    validate(frm) {
        if (frm.doc.leave_type !== "Short Leave") return;

        if (!frm.doc.custom_from_hours || !frm.doc.custom_to_hours) {
            frappe.throw(__("From Hours and To Hours are required for Short Leave"));
        }
        if (to_seconds(frm.doc.custom_from_hours) >= to_seconds(frm.doc.custom_to_hours)) {
            frappe.throw(__("To Hours must be after From Hours"));
        }
        if (frm.doc.from_date !== frm.doc.to_date) {
            frappe.throw(__("Short Leave must be applied for a single day"));
        }
    },
});

function to_seconds(t) {
    return t.split(":").reduce((a, v, i) => a + (+v) * [3600, 60, 1][i], 0);
}

function set_short_leave_days(frm) {
    if (frm.doc.leave_type !== "Short Leave") return;
    if (!frm.doc.custom_from_hours || !frm.doc.custom_to_hours) return;

    const hrs = (to_seconds(frm.doc.custom_to_hours) - to_seconds(frm.doc.custom_from_hours)) / 3600;
    frm.set_value("total_leave_days", hrs > 0 ? Math.round(hrs * 100) / 100 : 0);
}

function show_short_leave_balance(frm) {
    frm.dashboard.clear_headline();
    if (frm.doc.leave_type !== "Short Leave" || !frm.doc.employee || !frm.doc.from_date) return;

    frappe.call({
        method: "nmtg.override.leave_application.get_short_leave_balance",
        args: { employee: frm.doc.employee, date: frm.doc.from_date },
        callback(r) {
            if (!r.message) return;
            const b = r.message;
            frm.dashboard.set_headline(
                __("Short Leave this month: {0} of {1} hrs used, {2} hrs remaining", [b.used, b.limit, b.balance]),
                b.balance > 0 ? "blue" : "red"
            );
        },
    });
}