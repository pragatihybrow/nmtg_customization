// ============================================================
// File:  apps/nmtg/nmtg/public/js/quality_inspection_listview.js
// ============================================================

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

// ─── fetch all docs then render ───────────────────────────────────────────────
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

  open_challan_window(docs);
}

// ─── build HTML: ONE page, ONE table, all docs as rows ────────────────────────
function open_challan_window(docs) {
  // Use first doc for Lab name / Date (all should share company)
  const lab_name    = docs[0].company || "";
  const report_date = docs[0].report_date
    ? frappe.datetime.str_to_user(docs[0].report_date)
    : "";

  const data_rows = docs.map((doc, idx) => render_data_row(doc, idx + 1)).join("\n");

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

    .challan-title {
      background: #e2efda;
      font-weight: bold;
      font-size: 12px;
      padding: 4px 8px;
      border: 1px solid #999;
      border-bottom: none;
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

    .col-header { font-size: 10px; color: #555; font-style: italic; }
    .col-label  { font-weight: bold; }

    .test-type-list { margin: 0; padding: 0; list-style: none; }
    .test-type-list li {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 2px;
      font-size: 10px;
    }
    .test-type-list li input[type=checkbox] { pointer-events: none; }

    @media print {
      body { margin: 0; }
      .challan-page { padding: 8mm; }
      @page { size: A4 portrait; margin: 8mm; }
    }
  </style>
</head>
<body>
<div class="challan-page">

  <div class="challan-title">Challan</div>

  <table class="challan-table">

    <!-- Row 1: Lab name + Date -->
    <tr>
      <td colspan="4">
        <span class="col-label">Lab name</span><br>
        ${esc(lab_name)}
      </td>
      <td colspan="3">
        <span class="col-label">Date</span><br>
        ${esc(report_date)}
      </td>
    </tr>

    <!-- Row 2: Column headers -->
    <tr>
      <td style="width:5%"  class="col-label">Sr. No</td>
      <td style="width:18%" class="col-label">
        Nmtg Heat Number
      </td>
      <td style="width:28%" class="col-label">
        Item name
      </td>
      <td style="width:18%" class="col-label">Mill TC number / Vendor Heat Number</td>
      <td style="width:5%"  class="col-label">Qty</td>
      <td style="width:20%" class="col-label">Test Type</td>
      <td style="width:6%"  class="col-label">Remark</td>
    </tr>

    <!-- Data rows: one per selected QI -->
    ${data_rows}

  </table>

</div>
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

  const vendor_heat  = doc.custom_vendor_heat_number || "";
  const mill_tc_cell = [vendor_heat].filter(Boolean).join(" / ");

  const qty           = doc.sample_size != null ? doc.sample_size : "";
  const testing_types = doc.custom_testing_type || [];
  const material_name = doc.item_name || doc.item_code || "";
  const remark        = doc.remarks || "";

  return `<tr>
    <td>${sr_no}</td>
    <td>${esc(heat_number)}</td>
    <td>${esc(item_display)}</td>
    <td>${esc(mill_tc_cell)}</td>
    <td>${esc(String(qty))}</td>
    <td>
      ${render_testing_types(testing_types)}
    </td>
    <td>${esc(remark)}</td>
  </tr>`;
}

// ─── checkbox list for testing types ─────────────────────────────────────────
function render_testing_types(rows) {
  if (!rows || !rows.length) return "<em style='color:#aaa;font-size:10px'>—</em>";
  return `<ul class="test-type-list">
    ${rows.map((r) => `<li>
      <input type="checkbox" checked disabled/>
      ${esc(r.testing_type || "")}
    </li>`).join("")}
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