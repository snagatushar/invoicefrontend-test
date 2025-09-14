// App.jsx
import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const supabaseUrl = "https://begfjxlvjaubnizkvruw.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZ2ZqeGx2amF1Ym5pemt2cnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjM0MzcsImV4cCI6MjA3MTYzOTQzN30.P6s1vWqAhXaNclfQw1NQ8Sj974uQJxAmoYG9mPvpKSQ"; // Replace with your Supabase key
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

/** -------- Component -------- */
export default function App() {
  const { phonenumber } = useParams(); // Read phone from URL
  const [invoice, setInvoice] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  /** ---- Fetch Invoice ---- */
  const fetchData = async () => {
    if (!phonenumber) return;
    const { data, error } = await supabase
      .from("backend")
      .select("*")
      .eq("phonenumber", phonenumber)
      .single();
    if (error) {
      console.error(error);
      alert("Failed to load invoice.");
      return;
    }
    const uppercased = {
      ...data,
      Dealer: toUpperIfString(data.Dealer ?? ""),
      invoice_date: toUpperIfString(data.invoice_date ?? ""),
      status: toUpperIfString(data.status ?? ""),
    };
    setInvoice(uppercased);
  };

  useEffect(() => {
    fetchData();
  }, [phonenumber]);

  /** ---- PDF ---- */
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

  /** ---- Approve ---- */
  const handleApprove = async () => {
    if (!invoice) return;
    try {
      setLoading(true);
      const rows = normalizeRows(invoice);
      const total = rows.map((r) => num(r.quantity) * num(r.rate)).reduce((a, b) => a + b, 0);

      const { error: updateError } = await supabase
        .from("backend")
        .update({ status: "APPROVED", amount: total, total: total })
        .eq("phonenumber", invoice.phonenumber);
      if (updateError) throw updateError;

      const pdfBlob = generatePDFBlob({ ...invoice, status: "APPROVED" });
      const fileName = `invoice_${invoice.phonenumber}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(fileName);
      const pdfUrl = urlData.publicUrl;

      const { error: urlError } = await supabase
        .from("backend")
        .update({ pdf_url: pdfUrl })
        .eq("phonenumber", invoice.phonenumber);
      if (urlError) throw urlError;

      // Trigger webhook
      await fetch(
        "https://n8n-image2doc-u35379.vm.elestio.app/webhook-test/f06adee0-b5f2-40f4-a293-4ec1067a14b0",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "invoice_approved",
            invoice_number: invoice.invoice_number,
            phonenumber: invoice.phonenumber,
            total,
            pdf_url: pdfUrl,
          }),
        }
      );

      alert("✅ Approved, PDF uploaded & webhook sent!");
      fetchData();
    } catch (e) {
      console.error(e);
      alert("❌ Approve failed. See console.");
    } finally {
      setLoading(false);
    }
  };

  /** ---- Edit ---- */
  const handleEdit = () => {
    if (!invoice) return;
    const rows = normalizeRows(invoice);
    setEditId(invoice.phonenumber);
    setEditData({ ...invoice, rows });
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
      rows: [...s.rows, { productname: "", description: "", quantity: "", units: "", rate: "" }],
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
    const total = editData.rows.map((r) => num(r.quantity) * num(r.rate)).reduce((a, b) => a + b, 0);
    return { total };
  }, [editId, editData]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const rows = editData.rows.filter(
        (r) =>
          String(r.productname).trim() ||
          String(r.description).trim() ||
          String(r.quantity).trim() ||
          String(r.units).trim() ||
          String(r.rate).trim()
      );

      const payload = {
        invoice_number: editData.invoice_number ?? "",
        Dealer: editData.Dealer ?? "",
        phonenumber: editData.phonenumber ?? "",
        invoice_date: editData.invoice_date ?? "",
        productname: JSON.stringify(rows.map((r) => r.productname ?? "")),
        description: JSON.stringify(rows.map((r) => r.description ?? "")),
        quantity: JSON.stringify(rows.map((r) => r.quantity ?? "")),
        units: JSON.stringify(rows.map((r) => r.units ?? "")),
        rate: JSON.stringify(rows.map((r) => r.rate ?? "")),
        amount: calcEditTotals.total,
        total: calcEditTotals.total,
        status: "DRAFT",
      };

      const { error } = await supabase.from("backend").update(payload).eq("phonenumber", editId);
      if (error) throw error;

      alert("💾 Saved!");
      setEditId(null);
      setEditData({});
      fetchData();
    } catch (e) {
      console.error(e);
      alert("❌ Save failed. See console.");
    } finally {
      setLoading(false);
    }
  };

  if (!invoice) return <p>Loading invoice...</p>;

  const rows = normalizeRows(editId ? editData : invoice);
  const total = rows.map((r) => num(r.quantity) * num(r.rate)).reduce((a, b) => a + b, 0);
  const isEditing = editId === invoice.phonenumber;

  return (
    <div style={{ padding: 20, opacity: loading ? 0.6 : 1 }}>
      <h2>Invoice for {invoice.phonenumber}</h2>

      {isEditing ? (
        <div style={{ display: "grid", gap: 10, maxWidth: 600 }}>
          <label>
            Invoice No:&nbsp;
            <input value={editData.invoice_number} onChange={(e) => handleChangeHeader("invoice_number", e.target.value)} />
          </label>
          <label>
            Dealer:&nbsp;
            <input value={editData.Dealer} onChange={(e) => handleChangeHeader("Dealer", e.target.value)} />
          </label>
          <label>
            Phone:&nbsp;
            <input value={editData.phonenumber} onChange={(e) => handleChangeHeader("phonenumber", e.target.value)} />
          </label>
          <label>
            Date:&nbsp;
            <input value={editData.invoice_date} onChange={(e) => handleChangeHeader("invoice_date", e.target.value)} />
          </label>
          <div>Status: {invoice.status}</div>
        </div>
      ) : (
        <p>
          <b>Dealer:</b> {invoice.Dealer} <br />
          <b>Phone:</b> {invoice.phonenumber} <br />
          <b>Date:</b> {invoice.invoice_date} <br />
          <b>Status:</b> {invoice.status} <br />
          {invoice.pdf_url && (
            <a href={invoice.pdf_url} target="_blank" rel="noreferrer">
              📄 View PDF
            </a>
          )}
        </p>
      )}

      <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse" }}>
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
          {rows.map((r, i) => {
            const amount = num(r.quantity) * num(r.rate);
            return (
              <tr key={i}>
                {isEditing ? (
                  <>
                    <td>
                      <input value={r.productname} onChange={(e) => handleRowChange(i, "productname", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.description} onChange={(e) => handleRowChange(i, "description", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.quantity} onChange={(e) => handleRowChange(i, "quantity", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.units} onChange={(e) => handleRowChange(i, "units", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.rate} onChange={(e) => handleRowChange(i, "rate", e.target.value)} />
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
            <td colSpan={5} style={{ textAlign: "right", fontWeight: "bold" }}>
              TOTAL
            </td>
            <td style={{ fontWeight: "bold" }}>{isEditing ? calcEditTotals.total.toFixed(2) : total.toFixed(2)}</td>
            {isEditing && <td />}
          </tr>
        </tbody>
      </table>

      {isEditing ? (
        <>
          <button onClick={addRow} style={{ marginTop: 10, marginRight: 10 }}>
            Add Item
          </button>
          <button onClick={handleSave} style={{ marginTop: 10 }}>
            Save
          </button>
        </>
      ) : (
        <button onClick={handleEdit} style={{ marginTop: 10, marginRight: 10 }}>
          Edit
        </button>
      )}

      <button onClick={handleApprove} style={{ marginTop: 10, marginLeft: 10 }}>
        Approve
      </button>
    </div>
  );
}
