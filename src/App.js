// App.jsx
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BrowserRouter as Router, Routes, Route, useParams } from "react-router-dom";

const supabaseUrl = "https://begfjxlvjaubnizkvruw.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZ2ZqeGx2amF1Ym5pemt2cnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjM0MzcsImV4cCI6MjA3MTYzOTQzN30.P6s1vWqAhXaNclfQw1NQ8Sj974uQJxAmoYG9mPvpKSQ"; 
const supabase = createClient(supabaseUrl, supabaseKey);

/** -------- Helpers -------- */
const safeParse = (val) => {
  if (!val) return [];
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  if (Array.isArray(val)) return val;
  return [];
};

const toUpperIfString = (v) => (typeof v === "string" ? v.toUpperCase() : v);

const num = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const cleaned = String(v).replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

const normalizeRows = (inv) => {
  const productname = safeParse(inv.productname);
  const description = safeParse(inv.description);
  const quantity = safeParse(inv.quantity);
  const units = safeParse(inv.units);
  const rate = safeParse(inv.rate);

  const maxLen = Math.max(
    productname.length,
    description.length,
    quantity.length,
    units.length,
    rate.length
  );

  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const row = {
      productname: productname[i] ?? "",
      description: description[i] ?? "",
      quantity: quantity[i] ?? "",
      units: units[i] ?? "",
      rate: rate[i] ?? "",
    };
    const hasAny =
      String(row.productname).trim() ||
      String(row.description).trim() ||
      String(row.quantity).trim() ||
      String(row.units).trim() ||
      String(row.rate).trim();
    if (hasAny) rows.push(row);
  }
  return rows;
};

/** -------- User Invoice Component -------- */
function UserInvoices() {
  const { phonenumber } = useParams();
  const [invoices, setInvoices] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  /** ---- Fetch invoices for this user ---- */
  const fetchData = async () => {
    const { data, error } = await supabase
      .from("backend")
      .select("*")
      .eq("phonenumber", phonenumber);
    if (error) {
      console.error(error);
      alert("Failed to load invoices.");
      return;
    }
    const uppercased = data.map((inv) => ({
      ...inv,
      Dealer: toUpperIfString(inv.Dealer ?? ""),
      invoice_date: toUpperIfString(inv.invoice_date ?? ""),
      status: toUpperIfString(inv.status ?? ""),
    }));
    setInvoices(uppercased);
  };

  useEffect(() => {
    fetchData();
  }, [phonenumber]);

  /** ---- PDF Generation ---- */
  const generatePDFBlob = (invoiceLike) => {
    const rows = normalizeRows(invoiceLike);

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("INVOICE", 105, 20, { align: "center" });

    doc.setFontSize(12);
    doc.text(`Invoice No: ${invoiceLike.invoice_number ?? ""}`, 20, 40);
    doc.text(`Dealer: ${invoiceLike.Dealer ?? ""}`, 20, 50);
    doc.text(`Phone: ${invoiceLike.phonenumber ?? ""}`, 20, 60);
    doc.text(`Date: ${invoiceLike.invoice_date ?? ""}`, 20, 70);
    doc.text(`Status: ${invoiceLike.status ?? ""}`, 20, 80);

    let total = 0;
    const tableData = rows.map((r) => {
      const qty = num(r.quantity);
      const rate = num(r.rate);
      const line = qty * rate;
      total += line;
      return [
        r.productname || "",
        r.description || "",
        String(qty),
        r.units || "",
        rate.toFixed(2),
        line.toFixed(2),
      ];
    });

    autoTable(doc, {
      startY: 95,
      head: [["Product", "Description", "Quantity", "Units", "Rate", "Amount"]],
      body: [...tableData, ["", "", "", "", "Total", total.toFixed(2)]],
      theme: "grid",
      styles: { halign: "center", valign: "middle" },
    });

    const finalY = doc.lastAutoTable?.finalY ?? 120;
    doc.text("Authorized Signature: ____________________", 20, finalY + 20);

    return doc.output("blob");
  };

  /** ---- Approve Invoice ---- */
  const handleApprove = async (invoice) => {
    try {
      setLoading(true);
      const rows = normalizeRows(invoice);
      const amounts = rows.map((r) => num(r.quantity) * num(r.rate));
      const total = amounts.reduce((a, b) => a + b, 0);

      const { error: updateError } = await supabase
        .from("backend")
        .update({
          status: "APPROVED",
          amount: total,
          total: total,
        })
        .eq("phonenumber", invoice.phonenumber)
        .eq("invoice_number", invoice.invoice_number);
      if (updateError) throw updateError;

      const pdfBlob = generatePDFBlob({ ...invoice, status: "APPROVED" });
      const fileName = `invoice_${invoice.phonenumber}_${invoice.invoice_number}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(fileName, pdfBlob, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(fileName);
      const pdfUrl = urlData.publicUrl;

      const { error: urlError } = await supabase
        .from("backend")
        .update({ pdf_url: pdfUrl })
        .eq("phonenumber", invoice.phonenumber)
        .eq("invoice_number", invoice.invoice_number);
      if (urlError) throw urlError;

      // 🔔 Trigger your webhook after approval
      await fetch(
        "https://n8n-image2doc-u35379.vm.elestio.app/webhook-test/f06adee0-b5f2-40f4-a293-4ec1067a14b0",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phonenumber: invoice.phonenumber,
            invoice_number: invoice.invoice_number,
            pdf_url: pdfUrl,
            total,
            status: "APPROVED",
          }),
        }
      );

      alert("✅ Approved, PDF uploaded & webhook triggered!");
      fetchData();
    } catch (e) {
      console.error(e);
      alert("❌ Approve failed. See console.");
    } finally {
      setLoading(false);
    }
  };

  /** ---- Edit / Save ---- */
  const handleEdit = (inv) => {
    const rows = normalizeRows(inv);
    setEditId(inv.invoice_number);
    setEditData({ ...inv, rows });
  };

  const handleChangeHeader = (field, value) => {
    setEditData((s) => ({ ...s, [field]: value ?? "" }));
  };

  const handleRowChange = (index, field, value) => {
    setEditData((s) => {
      const rows = [...s.rows];
      rows[index] = { ...rows[index], [field]: value ?? "" };
      return { ...s, rows };
    });
  };

  const addRow = () => {
    setEditData((s) => ({
      ...s,
      rows: [
        ...s.rows,
        { productname: "", description: "", quantity: "", units: "", rate: "" },
      ],
    }));
  };

  const removeRow = (i) => {
    setEditData((s) => ({
      ...s,
      rows: s.rows.filter((_, idx) => idx !== i),
    }));
  };

  const calcEditTotals = useMemo(() => {
    if (!editId || !editData?.rows) return { total: 0 };
    const total = editData.rows
      .map((r) => num(r.quantity) * num(r.rate))
      .reduce((a, b) => a + b, 0);
    return { total };
  }, [editId, editData]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const rows = editData.rows.filter(
        (r) => r.productname || r.description || r.quantity || r.units || r.rate
      );

      const payload = {
        invoice_number: editData.invoice_number,
        Dealer: editData.Dealer,
        phonenumber: editData.phonenumber,
        invoice_date: editData.invoice_date,
        productname: JSON.stringify(rows.map((r) => r.productname)),
        description: JSON.stringify(rows.map((r) => r.description)),
        quantity: JSON.stringify(rows.map((r) => r.quantity)),
        units: JSON.stringify(rows.map((r) => r.units)),
        rate: JSON.stringify(rows.map((r) => r.rate)),
        total: calcEditTotals.total,
        amount: calcEditTotals.total,
        status: "DRAFT",
      };

      const { error } = await supabase
        .from("backend")
        .update(payload)
        .eq("invoice_number", editId)
        .eq("phonenumber", phonenumber);
      if (error) throw error;

      alert("💾 Saved!");
      setEditId(null);
      setEditData({});
      fetchData();
    } catch (e) {
      console.error(e);
      alert("❌ Save failed.");
    } finally {
      setLoading(false);
    }
  };

  /** ---- Render ---- */
  return (
    <div style={{ padding: 20, opacity: loading ? 0.6 : 1 }}>
      <h2>Invoices for {phonenumber}</h2>
      {invoices.map((inv) => {
        const rows = normalizeRows(inv);
        const total = rows
          .map((r) => num(r.quantity) * num(r.rate))
          .reduce((a, b) => a + b, 0);
        const isEditing = editId === inv.invoice_number;

        return (
          <div
            key={inv.invoice_number}
            style={{
              border: "2px solid #222",
              marginBottom: 20,
              padding: 12,
              borderRadius: 8,
            }}
          >
            <h3>
              INVOICE:{" "}
              {isEditing ? (
                <input
                  value={editData.invoice_number}
                  onChange={(e) =>
                    handleChangeHeader("invoice_number", e.target.value)
                  }
                />
              ) : (
                inv.invoice_number
              )}
            </h3>

            {isEditing ? (
              <div style={{ display: "grid", gap: 6, maxWidth: 600 }}>
                <label>
                  Dealer:{" "}
                  <input
                    value={editData.Dealer}
                    onChange={(e) =>
                      handleChangeHeader("Dealer", e.target.value)
                    }
                  />
                </label>
                <label>
                  Phone:{" "}
                  <input
                    value={editData.phonenumber}
                    onChange={(e) =>
                      handleChangeHeader("phonenumber", e.target.value)
                    }
                  />
                </label>
                <label>
                  Date:{" "}
                  <input
                    value={editData.invoice_date}
                    onChange={(e) =>
                      handleChangeHeader("invoice_date", e.target.value)
                    }
                  />
                </label>
                <div>Status: {inv.status}</div>
              </div>
            ) : (
              <p>
                <b>DEALER:</b> {inv.Dealer}
                <br />
                <b>PHONE:</b> {inv.phonenumber}
                <br />
                <b>DATE:</b> {inv.invoice_date}
                <br />
                <b>STATUS:</b> {inv.status}
                <br />
                {inv.pdf_url && (
                  <a href={inv.pdf_url} target="_blank" rel="noreferrer">
                    📄 View PDF
                  </a>
                )}
              </p>
            )}

            <table
              border="1"
              cellPadding="6"
              style={{ marginTop: 10, width: "100%", borderCollapse: "collapse" }}
            >
              <thead>
                <tr>
                  <th>PRODUCT</th>
                  <th>DESCRIPTION</th>
                  <th>QUANTITY</th>
                  <th>UNITS</th>
                  <th>RATE</th>
                  <th>AMOUNT</th>
                  {isEditing && <th>ACTION</th>}
                </tr>
              </thead>
              <tbody>
                {(isEditing ? editData.rows : rows).map((r, i) => {
                  const amount = num(r.quantity) * num(r.rate);
                  return (
                    <tr key={i}>
                      {isEditing ? (
                        <>
                          <td>
                            <input
                              value={r.productname}
                              onChange={(e) =>
                                handleRowChange(i, "productname", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={r.description}
                              onChange={(e) =>
                                handleRowChange(i, "description", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={r.quantity}
                              onChange={(e) =>
                                handleRowChange(i, "quantity", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={r.units}
                              onChange={(e) =>
                                handleRowChange(i, "units", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={r.rate}
                              onChange={(e) =>
                                handleRowChange(i, "rate", e.target.value)
                              }
                            />
                          </td>
                          <td>{amount.toFixed(2)}</td>
                          <td>
                            <button onClick={() => removeRow(i)}>Remove</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{r.productname}</td>
                          <td>{r.description}</td>
                          <td>{r.quantity}</td>
                          <td>{r.units}</td>
                          <td>{r.rate}</td>
                          <td>{amount.toFixed(2)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: "right", fontWeight: "bold" }}
                  >
                    TOTAL
                  </td>
                  <td style={{ fontWeight: "bold" }}>
                    {isEditing
                      ? calcEditTotals.total.toFixed(2)
                      : total.toFixed(2)}
                  </td>
                  {isEditing && <td />}
                </tr>
              </tbody>
            </table>

            {isEditing ? (
              <>
                <button
                  onClick={addRow}
                  style={{ marginTop: 10, marginRight: 10 }}
                >
                  Add Item
                </button>
                <button onClick={handleSave} style={{ marginTop: 10 }}>
                  Save
                </button>
              </>
            ) : (
              <button
                onClick={() => handleEdit(inv)}
                style={{ marginTop: 10, marginRight: 10 }}
              >
                Edit
              </button>
            )}

            <button
              onClick={() => handleApprove(inv)}
              style={{ marginTop: 10, marginLeft: 10 }}
            >
              Approve
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** -------- App Wrapper -------- */
export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/user/:phonenumber" element={<UserInvoices />} />
        <Route
          path="*"
          element={<p>Invalid URL. Use /user/&lt;phonenumber&gt;</p>}
        />
      </Routes>
    </Router>
  );
}
