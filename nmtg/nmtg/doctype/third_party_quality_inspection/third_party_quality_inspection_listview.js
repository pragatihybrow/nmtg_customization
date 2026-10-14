const TPQI_LETTER_HEAD = "Letter Head NMTG";

frappe.listview_settings["Third Party Quality Inspection"] = {
  onload(listview) {
    listview.page.add_action_item(__("Print Preview"), () => {
      const names = tpqi_get_selected_names(listview);
      if (names) tpqi_print_challans(names, { autoPrint: false });
    });

    // listview.page.add_action_item(__("Print Challan"), () => {
    //   const names = tpqi_get_selected_names(listview);
    //   if (names) tpqi_print_challans(names, { autoPrint: true });
    // });
  },
};

// ─── helper: validate selection, return list of names or null ───────────────
function tpqi_get_selected_names(listview) {
  const selected = listview.get_checked_items();
  if (!selected.length) {
    frappe.msgprint(__("Please select at least one Third Party Quality Inspection record."));
    return null;
  }
  return selected.map((r) => r.name);
}

// ─── fetch letter head (header + footer HTML) ────────────────────────────────
async function tpqi_fetch_letter_head() {
  try {
    const r = await frappe.call({
      method: "frappe.client.get_value",
      args: {
        doctype: "Letter Head",
        filters: { name: TPQI_LETTER_HEAD },
        fieldname: ["content", "footer"],
      },
    });
    const m = r.message || {};
    return { header: m.content || "", footer: m.footer || "" };
  } catch (e) {
    console.warn("Could not fetch letter head:", TPQI_LETTER_HEAD, e);
    return { header: "", footer: "" };
  }
}

// ─── fetch all docs, group by lab + date, assign series, then render ─────────
async function tpqi_print_challans(names, { autoPrint = true } = {}) {
  frappe.show_progress(__("Preparing Challan…"), 0, names.length);

  const docs = [];
  for (let i = 0; i < names.length; i++) {
    const r = await frappe.call({
      method: "frappe.client.get",
      args: { doctype: "Third Party Quality Inspection", name: names[i] },
    });
    if (r.message) docs.push(r.message);
    frappe.show_progress(__("Preparing Challan…"), i + 1, names.length);
  }

  frappe.hide_progress();

  if (!docs.length) {
    frappe.msgprint(__("No data found for selected records."));
    return;
  }

  // ── Group by lab_name + report_date ───────────────────────────────────────
  const groups = {};
  for (const doc of docs) {
    const supplier = doc.lab_name    || "__no_supplier__";
    const date     = doc.report_date || "__no_date__";
    const key      = `${supplier}||${date}`;
    if (!groups[key]) groups[key] = { supplier, date, docs: [] };
    groups[key].docs.push(doc);
  }

  // ── For each group: get or create qc_series (server also saves it) ────────
  const group_list = Object.values(groups);
  frappe.show_progress(__("Assigning Challan IDs…"), 0, group_list.length);
  let g_idx = 0;

  for (const group of group_list) {
    const names_in_group = group.docs.map((d) => d.name);

    const r = await frappe.call({
      method: "nmtg.override.api.get_or_create_tpqi_series",
      args: { tpqi_names: JSON.stringify(names_in_group) },
    });

    const series = r.message || "";
    group.docs.forEach((d) => { d.qc_series = series; });
    group.qc_series = series;

    frappe.show_progress(__("Assigning Challan IDs…"), ++g_idx, group_list.length);
  }

  frappe.hide_progress();

  // ── Fetch address for each unique lab + the letter head in parallel ───────
  const unique_suppliers = [...new Set(
    group_list.map((g) => g.supplier).filter((s) => s !== "__no_supplier__")
  )];

  const supplier_addresses = {};
  const [letter_head] = await Promise.all([
    tpqi_fetch_letter_head(),
    ...unique_suppliers.map(async (supplier) => {
      supplier_addresses[supplier] = await tpqi_fetch_supplier_address(supplier);
    }),
  ]);

  tpqi_open_challan_window(groups, supplier_addresses, letter_head, autoPrint);
}

// ─── fetch primary address for a supplier ─────────────────────────────────────
async function tpqi_fetch_supplier_address(supplier) {
  const fields = ["address_line1", "address_line2", "city", "state", "pincode", "country"];
  try {
    const r = await frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: "Address",
        filters: [
          ["Dynamic Link", "link_doctype", "=", "Supplier"],
          ["Dynamic Link", "link_name",    "=", supplier],
          ["is_primary_address",           "=", 1],
        ],
        fields,
        limit: 1,
      },
    });
    if (r.message && r.message.length) return r.message[0];

    const fallback = await frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: "Address",
        filters: [
          ["Dynamic Link", "link_doctype", "=", "Supplier"],
          ["Dynamic Link", "link_name",    "=", supplier],
        ],
        fields,
        limit: 1,
      },
    });
    return fallback.message && fallback.message.length ? fallback.message[0] : null;
  } catch (e) {
    console.warn("Could not fetch address for lab:", supplier, e);
    return null;
  }
}

// ─── format address object into a single line ─────────────────────────────────
function tpqi_format_address(addr) {
  if (!addr) return "";
  return [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode, addr.country]
    .filter(Boolean)
    .join(", ");
}

// ─── build HTML: one page per lab + date group ───────────────────────────────
function tpqi_open_challan_window(groups, supplier_addresses, letter_head, autoPrint) {
  const pages = Object.values(groups).map(({ supplier, date, docs, qc_series }) => {
    const supplier_label = supplier === "__no_supplier__" ? "—" : supplier;
    const address_str    = tpqi_format_address(supplier_addresses[supplier] || null);
    const report_date    = date !== "__no_date__" ? frappe.datetime.str_to_user(date) : "";

    const data_rows = docs.map((doc, idx) => tpqi_render_data_row(doc, idx + 1)).join("\n");

    return `
    <div class="challan-page">
      <div class="challan-header">${letter_head.header || ""}</div>

      <div class="challan-body">
        <div class="challan-title">Challan &nbsp;&nbsp; <span style="font-weight:normal;font-size:11px;">${tpqi_esc(qc_series || "")}</span></div>
        <table class="challan-table">

          <tr>
            <td colspan="4">
              <span class="col-label">Lab name</span><br>
              ${tpqi_esc(supplier_label)}
              ${address_str ? `<br><span class="col-address">${tpqi_esc(address_str)}</span>` : ""}
            </td>
            <td colspan="3">
              <span class="col-label">Date</span><br>
              ${tpqi_esc(report_date)}
            </td>
          </tr>

          <tr>
            <td style="width:5%"  class="col-label">Sr. No</td>
            <td style="width:18%" class="col-label">Nmtg Heat Number</td>
            <td style="width:28%" class="col-label">Item name</td>
            <td style="width:18%" class="col-label">Mill TC number / Vendor Heat Number</td>
            <td style="width:5%"  class="col-label">Qty</td>
            <td style="width:20%" class="col-label">Test Type</td>
            <td style="width:6%"  class="col-label">Remark</td>
          </tr>

          ${data_rows}

        </table>
      </div>

      <div class="challan-footer">${letter_head.footer || ""}</div>
    </div>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Third Party QC Challan</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #000;
      background: #fff;
    }

    .challan-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #f5f5f5;
      border-bottom: 1px solid #ccc;
      padding: 10px 16px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .challan-toolbar button {
      font-size: 13px;
      padding: 6px 18px;
      border: 1px solid #888;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
    }
    .challan-toolbar button.primary {
      background: #2490ef;
      color: #fff;
      border-color: #2490ef;
    }
    .challan-toolbar button:hover { opacity: 0.85; }

    /* one A4 page per group: header on top, footer pinned to the bottom */
    .challan-page {
      width: 210mm;
      min-height: 297mm;
      margin: 10px auto;
      padding: 10mm;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 4px rgba(0,0,0,0.25);
    }
    .challan-header { margin-bottom: 14px; }
    .challan-body   { flex: 1 0 auto; }
    .challan-footer { margin-top: 16px; flex-shrink: 0; }

    .challan-title {
      background: #e2efda;
      font-weight: bold;
      font-size: 12px;
      padding: 4px 8px;
      border: 1px solid #999;
      border-bottom: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .challan-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #999;
    }
    .challan-table td {
      border: 1px solid #999;
      padding: 4px 6px;
      vertical-align: top;
      font-size: 11px;
    }

    .col-label   { font-weight: bold; }
    .col-address { font-size: 10px; color: #444; margin-top: 2px; display: block; }

    .test-type-list { margin: 0; padding: 0; list-style: none; }
    .test-type-list li {
      font-size: 10px;
      margin-bottom: 2px;
    }

    @media print {
      body { margin: 0; }
      .challan-toolbar { display: none !important; }
      .challan-page {
        margin: 0;
        padding: 0;
        box-shadow: none;
        width: 100%;
        min-height: 279mm;
      }
      .challan-page + .challan-page { break-before: page; page-break-before: always; }
      .challan-table tr { break-inside: avoid; }
      @page { size: A4 portrait; margin: 8mm; }
    }
  </style>
</head>
<body>
  <div class="challan-toolbar">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>
  ${pages}
${autoPrint ? `<script>window.onload = () => { window.print(); };<\/script>` : ""}
</body>
</html>`;

  const w = window.open(
    "",
    "_blank",
    `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`
  );
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─── render a single <tr> for one TPQI doc ───────────────────────────────────
function tpqi_render_data_row(doc, sr_no) {
  // codes selected in the form; falls back to the full heat number range
  const heat_number  = doc.nmtg_code_data || doc.nmtg_heat_number || "";
  const item_display = [doc.item_code, doc.item_name].filter(Boolean).join(" – ");
  const qty          = doc.qty != null ? doc.qty : "";
  const testing_types = doc.testing_type || [];
  const remark       = doc.remark || "";

  return `<tr>
    <td>${sr_no}</td>
    <td>${tpqi_esc(heat_number)}</td>
    <td>${tpqi_esc(item_display)}</td>
    <td></td>
    <td>${tpqi_esc(String(qty))}</td>
    <td>${tpqi_render_testing_types(testing_types)}</td>
    <td>${tpqi_esc(remark)}</td>
  </tr>`;
}

// ─── plain list for testing types ────────────────────────────────────────────
function tpqi_render_testing_types(rows) {
  if (!rows || !rows.length) return "<em style='color:#aaa;font-size:10px'>—</em>";
  return `<ul class="test-type-list">
    ${rows.map((r) => `<li>${tpqi_esc(r.testing_type || "")}</li>`).join("")}
  </ul>`;
}

// ─── HTML-escape helper ───────────────────────────────────────────────────────
function tpqi_esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}