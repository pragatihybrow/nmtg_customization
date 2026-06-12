frappe.listview_settings["Quality Inspection"] = {
  onload(listview) {
    listview.page.add_action_item(__("Print Challan"), () => {
      const selected = listview.get_checked_items();
      if (!selected.length) {
        frappe.msgprint(__("Please select at least one Quality Inspection record."));
        return;
      }
      print_challans(selected.map((r) => r.name));
    });
  },
};

// ─── fetch all docs, group by supplier + date, assign series, then render ─────
async function print_challans(names) {
  frappe.show_progress(__("Preparing Challan…"), 0, names.length);

  const docs = [];
  for (let i = 0; i < names.length; i++) {
    const r = await frappe.call({
      method: "frappe.client.get",
      args: { doctype: "Quality Inspection", name: names[i] },
    });
    if (r.message) docs.push(r.message);
    frappe.show_progress(__("Preparing Challan…"), i + 1, names.length);
  }

  frappe.hide_progress();

  if (!docs.length) {
    frappe.msgprint(__("No data found for selected records."));
    return;
  }

  // ── Group by custom_supplier + report_date ────────────────────────────────
  const groups = {};
  for (const doc of docs) {
    const supplier = doc.custom_supplier || "__no_supplier__";
    const date     = doc.report_date     || "__no_date__";
    const key      = `${supplier}||${date}`;
    if (!groups[key]) groups[key] = { supplier, date, docs: [] };
    groups[key].docs.push(doc);
  }

  // ── For each group: get or create qc_series, assign to all docs in group ──
  frappe.show_progress(__("Assigning Challan IDs…"), 0, Object.keys(groups).length);
  let g_idx = 0;

  for (const group of Object.values(groups)) {
    const qi_names = group.docs.map(d => d.name);

    const r = await frappe.call({
      method: "nmtg.override.api.get_or_create_qc_series",
      args: { qi_names: JSON.stringify(qi_names) }
    });

    const series = r.message || "";

    // Stamp the series on every doc in this group (in-memory for rendering)
    group.docs.forEach(d => { d.custom_qc_series = series; });
    group.qc_series = series;

    frappe.show_progress(__("Assigning Challan IDs…"), ++g_idx, Object.keys(groups).length);
  }

  frappe.hide_progress();

  // ── Fetch address for each unique supplier in parallel ────────────────────
  const unique_suppliers = [...new Set(
    Object.values(groups)
      .map(g => g.supplier)
      .filter(s => s !== "__no_supplier__")
  )];

  const supplier_addresses = {};
  await Promise.all(
    unique_suppliers.map(async supplier => {
      supplier_addresses[supplier] = await fetch_supplier_address(supplier);
    })
  );

  open_challan_window(groups, supplier_addresses);
}

// ─── fetch primary address for a supplier ─────────────────────────────────────
async function fetch_supplier_address(supplier) {
  try {
    const r = await frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: "Address",
        filters: [
          ["Dynamic Link", "link_doctype", "=", "Supplier"],
          ["Dynamic Link", "link_name",    "=", supplier],
          ["is_primary_address",           "=", 1]
        ],
        fields: ["address_line1", "address_line2", "city", "state", "pincode", "country"],
        limit: 1
      }
    });
    if (r.message && r.message.length) return r.message[0];

    const fallback = await frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: "Address",
        filters: [
          ["Dynamic Link", "link_doctype", "=", "Supplier"],
          ["Dynamic Link", "link_name",    "=", supplier]
        ],
        fields: ["address_line1", "address_line2", "city", "state", "pincode", "country"],
        limit: 1
      }
    });
    return (fallback.message && fallback.message.length) ? fallback.message[0] : null;

  } catch (e) {
    console.warn("Could not fetch address for supplier:", supplier, e);
    return null;
  }
}

// ─── format address object into a single line ─────────────────────────────────
function format_address(addr) {
  if (!addr) return "";
  return [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode, addr.country]
    .filter(Boolean)
    .join(", ");
}

// ─── build HTML: one page per supplier + date group ──────────────────────────
function open_challan_window(groups, supplier_addresses) {

  const pages = Object.values(groups).map(({ supplier, date, docs, qc_series }) => {
    const supplier_label = supplier === "__no_supplier__" ? "—" : supplier;
    const address_str    = format_address(supplier_addresses[supplier] || null);
    const report_date    = date !== "__no_date__"
      ? frappe.datetime.str_to_user(date)
      : "";

    const data_rows = docs.map((doc, idx) => render_data_row(doc, idx + 1)).join("\n");

    return `
    <div class="challan-page">
      <div class="challan-title">Challan &nbsp;&nbsp; <span style="font-weight:normal;font-size:11px;">${esc(qc_series || "")}</span></div>
      <table class="challan-table">

        <!-- Row 1: Lab name (Supplier + Address) + Date -->
        <tr>
          <td colspan="4">
            <span class="col-label">Lab name</span><br>
            ${esc(supplier_label)}
            ${address_str ? `<br><span class="col-address">${esc(address_str)}</span>` : ""}
          </td>
          <td colspan="3">
            <span class="col-label">Date</span><br>
            ${esc(report_date)}
          </td>
        </tr>

        <!-- Row 2: Column headers -->
        <tr>
          <td style="width:5%"  class="col-label">Sr. No</td>
          <td style="width:18%" class="col-label">Nmtg Heat Number</td>
          <td style="width:28%" class="col-label">Item name</td>
          <td style="width:18%" class="col-label">Mill TC number / Vendor Heat Number</td>
          <td style="width:5%"  class="col-label">Qty</td>
          <td style="width:20%" class="col-label">Test Type</td>
          <td style="width:6%"  class="col-label">Remark</td>
        </tr>

        <!-- Data rows -->
        ${data_rows}

      </table>
    </div>`;

  }).join('<div class="page-break"></div>\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Quality Inspection Challan</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #000;
      background: #fff;
    }

    .challan-page {
      width: 210mm;
      margin: 0 auto;
      padding: 10mm;
    }

    .page-break {
      page-break-after: always;
      break-after: page;
    }

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
      .challan-page { padding: 8mm; }
      .page-break { page-break-after: always; break-after: page; }
      @page { size: A4 portrait; margin: 8mm; }
    }
  </style>
</head>
<body>
  ${pages}
<script>
  window.onload = () => { window.print(); };
<\/script>
</body>
</html>`;

  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─── render a single <tr> for one QI doc ─────────────────────────────────────
function render_data_row(doc, sr_no) {
  const heat_number  = doc.custom_nmtg_heat_number || "";
  const item_display = [doc.item_code, doc.item_name].filter(Boolean).join(" – ");

  // const mill_tc_raw  = doc.custom_mill_tc || "";
  // const mill_tc      = mill_tc_raw ? mill_tc_raw.split("/").pop() : "";
  const vendor_heat  = doc.custom_vendor_heat_number || "";
  const mill_tc_cell = [esc(vendor_heat)].filter(Boolean).join("<br>");

  const qty           = doc.sample_size != null ? doc.sample_size : "";
  const testing_types = doc.custom_testing_type || [];
  const remark        = doc.remarks || "";

  return `<tr>
    <td>${sr_no}</td>
    <td>${esc(heat_number)}</td>
    <td>${esc(item_display)}</td>
    <td>${mill_tc_cell}</td>
    <td>${esc(String(qty))}</td>
    <td>${render_testing_types(testing_types)}</td>
    <td>${esc(remark)}</td>
  </tr>`;
}

// ─── plain list for testing types ────────────────────────────────────────────
function render_testing_types(rows) {
  if (!rows || !rows.length) return "<em style='color:#aaa;font-size:10px'>—</em>";
  return `<ul class="test-type-list">
    ${rows.map((r) => `<li>${esc(r.testing_type || "")}</li>`).join("")}
  </ul>`;
}

// ─── HTML-escape helper ───────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}