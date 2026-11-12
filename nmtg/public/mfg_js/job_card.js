frappe.ui.form.on("Job Card", {
    refresh(frm) {
        const btn_label = __("Transfer Excess Material");
        frm.remove_custom_button(btn_label);

        if (!frm.is_new() && frm.doc.docstatus < 2 && frm.doc.custom_transfer_endpiece) {
            // Show the button only if no active endpiece Stock Entry exists yet
            frappe.db.get_list("Stock Entry", {
                filters: {
                    job_card: frm.doc.name,
                    remarks: `Endpiece excess transfer for ${frm.doc.name}`,
                    docstatus: ["!=", 2],
                },
                fields: ["name"],
                limit: 1,
            }).then((res) => {
                if (res && res.length) return;
                add_transfer_button(frm, btn_label);
            });
        }

        // Lock the checkbox if another Job Card of this Work Order already has it
        if (frm.doc.work_order && !frm.doc.custom_transfer_endpiece) {
            frappe.db.get_list("Job Card", {
                filters: {
                    work_order: frm.doc.work_order,
                    custom_transfer_endpiece: 1,
                    docstatus: ["!=", 2],
                    name: ["!=", frm.doc.name || ""],
                },
                fields: ["name"],
                limit: 1,
            }).then((res) => {
                const taken = res && res.length;
                frm.set_df_property("custom_transfer_endpiece", "read_only", taken ? 1 : 0);
                frm.set_df_property(
                    "custom_transfer_endpiece",
                    "description",
                    taken ? __("Already checked on {0}", [res[0].name]) : ""
                );
            });
        } else {
            frm.set_df_property("custom_transfer_endpiece", "read_only", 0);
            frm.set_df_property("custom_transfer_endpiece", "description", "");
        }
    },

    custom_transfer_endpiece(frm) {
        if (!frm.doc.custom_transfer_endpiece || !frm.doc.work_order) return;
        frappe.db.get_list("Job Card", {
            filters: {
                work_order: frm.doc.work_order,
                custom_transfer_endpiece: 1,
                docstatus: ["!=", 2],
                name: ["!=", frm.doc.name || ""],
            },
            fields: ["name"],
            limit: 1,
        }).then((res) => {
            if (res && res.length) {
                frm.set_value("custom_transfer_endpiece", 0);
                frappe.msgprint(__("Transfer Endpiece is already checked on Job Card {0} for this Work Order.", [res[0].name]));
            }
        });
    },
});

function add_transfer_button(frm, btn_label) {
    frm.add_custom_button(btn_label, () => {
        if (!frm.doc.custom_endpiece_warehouse) {
            frappe.msgprint(__("Please set the Endpiece Warehouse and save."));
            return;
        }
        if (frm.is_dirty()) {
            frappe.msgprint(__("Please save the Job Card first."));
            return;
        }

        // Build the preview of what will move where (same rule as the server)
        const esc = frappe.utils.escape_html;
        const preview = [];
        (frm.doc.items || []).forEach((d) => {
            const excess = flt(d.transferred_qty) - flt(d.required_qty) - flt(d.custom_endpiece_transfered_qty);
            if (excess <= 0) return;
            const is_endpiece = excess <= 100;
            preview.push({
                item_code: d.item_code,
                item_name: d.item_name,
                excess: excess,
                uom: d.uom || d.stock_uom,
                target: is_endpiece ? frm.doc.custom_endpiece_warehouse : d.source_warehouse,
                is_endpiece: is_endpiece,
            });
        });

        if (!preview.length) {
            frappe.msgprint(__("No excess transferred material found on this Job Card."));
            return;
        }

        const rows = preview.map((p) => `
            <tr>
                <td>${esc(p.item_code)}${p.item_name ? "<br><small class='text-muted'>" + esc(p.item_name) + "</small>" : ""}</td>
                <td class="text-right">${format_number(p.excess)} ${esc(p.uom || "")}</td>
                <td>${p.target ? esc(p.target) : "<span class='text-danger'>" + __("Source Warehouse not set") + "</span>"}
                    <br><small class="text-muted">${p.is_endpiece
                        ? __("Endpiece (qty <= 100)")
                        : __("Source Warehouse (qty > 100)")}</small>
                </td>
            </tr>`).join("");

        const msg = `
            <p>${__("The following excess material will be transferred from {0}:", [
                "<b>" + esc(frm.doc.wip_warehouse || "") + "</b>",
            ])}</p>
            <table class="table table-bordered table-sm">
                <thead>
                    <tr>
                        <th>${__("Item")}</th>
                        <th class="text-right">${__("Excess Qty")}</th>
                        <th>${__("Transfer To")}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;

        frappe.confirm(msg, () => {
            frappe.call({
                method: "nmtg.override.mfg_py.job_card.transfer_endpiece_excess",
                args: { job_card: frm.doc.name },
                freeze: true,
                freeze_message: __("Creating Stock Entry..."),
                callback(r) {
                    if (r.message) {
                        frm.remove_custom_button(btn_label);
                        frappe.set_route("Form", "Stock Entry", r.message);
                    }
                },
            });
        });
    });
}