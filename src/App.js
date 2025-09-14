// App.jsx
import React, { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BrowserRouter as Router, Routes, Route, useParams, Link } from "react-router-dom";

// -------- Supabase Setup --------
const supabaseUrl = "https://begfjxlvjaubnizkvruw.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZ2ZqeGx2amF1Ym5pemt2cnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjM0MzcsImV4cCI6MjA3MTYzOTQzN30.P6s1vWqAhXaNclfQw1NQ8Sj974uQJxAmoYG9mPvpKSQ";
const supabase = createClient(supabaseUrl, supabaseKey);

// -------- Helpers --------
const safeParse = (val) => {
  if (!val) return [];
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
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
  const maxLen = Math.max(productname.length, description.length, quantity.length, units.length, rate.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const row = {
      productname: productname[i] ?? "",
      description: description[i] ?? "",
      quantity: quantity[i] ?? "",
      units: units[i] ?? "",
      rate: rate[i] ?? "",
    };
    if (Object.values(row).some(v => String(v).trim() !== "")) rows.push(row);
  }
  return rows;
};

// -------- Home Component --------
function Home() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from("backend")
      .select("phonenumber")
      .neq("phonenumber", null);
    if (error) return console.error(error);
    const uniquePhones = [...new Set(data.map(item => item.phonenumber))];
    setUsers(uniquePhones);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>All Users</h2>
      <ul>
        {users.map((phone) => (
          <li key={phone}>
            <Link to={`/user/${phone}`}>{phone}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -------- UserInvoices Component --------
function UserInvoices() {
  const { phonenumber } = useParams();
  const [invoices, setInvoices] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    const { data, error } = await supabase.from("backend").select("*").eq("phonenumber", phonenumber);
    if (error) return console.error(error);
    const uppercased = data.map((inv) => ({
      ...inv,
      Dealer: toUpperIfString(inv.Dealer ?? ""),
      invoice_date: toUpperIfString(inv.invoice_date ?? ""),
      status: toUpperIfString(inv.status ?? ""),
    }));
    setInvoices(uppercased);
  };

  useEffect(() => { fetchData(); }, [phonenumber]);

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
      return [r.productname || "", r.description || "", String(qty), r.units || "", rate.toFixed(2), line.toFixed(2)];
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

  const handleApprove = async (invoice) => {
    try {
      setLoading(true);
      const rows = normalizeRows(invoice);
      const total = rows.map((r) => num(r.quantity) * num(r.rate)).reduce((a, b) => a + b, 0);
      const { error: updateError } = await supabase
        .from("backend")
        .update({ status: "APPROVED", amount: total, total: total })
        .eq("phonenumber", invoice.phonenumber)
        .eq("invoice_number", invoice.invoice_number);
      if (updateError) throw updateError;

      const pdfBlob = generatePDFBlob({ ...invoice, status: "APPROVED" });
      const fileName = `invoice_${invoice.phonenumber}_${invoice.invoice_number}.pdf`;
      const { error: uploadError } = await supabase.storage.from("invoices").upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(fileName);
      await supabase.from("backend").update({ pdf_url: urlData.publicUrl }).eq("phonenumber", invoice.phonenumber).eq("invoice_number", invoice.invoice_number);
      alert("✅ Approved & PDF uploaded!");
      fetchData();
    } catch (e) {
      console.error(e);
      alert("❌ Approve failed. See console.");
    } finally { setLoading(false); }
  };

  /** ---- Render ---- */
  return (
    <div style={{ padding: 20, opacity: loading ? 0.6 : 1 }}>
      <h2>Invoices for {phonenumber}</h2>
      <Link to="/">⬅ Back to Users</Link>
      {invoices.map((inv) => {
        const rows = normalizeRows(inv);
        const total = rows.map((r) => num(r.quantity) * num(r.rate)).reduce((a, b) => a + b, 0);
        return (
          <div key={inv.invoice_number} style={{ border: "2px solid #222", marginBottom: 20, padding: 12, borderRadius: 8 }}>
            <h3>INVOICE: {inv.invoice_number}</h3>
            <p>
              <b>DEALER:</b> {inv.Dealer}<br/>
              <b>PHONE:</b> {inv.phonenumber}<br/>
              <b>DATE:</b> {inv.invoice_date}<br/>
              <b>STATUS:</b> {inv.status}<br/>
              {inv.pdf_url && <a href={inv.pdf_url} target="_blank" rel="noreferrer">📄 View PDF</a>}
            </p>
            <table border="1" cellPadding="6" style={{ marginTop: 10, width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>PRODUCT</th><th>DESCRIPTION</th><th>QUANTITY</th><th>UNITS</th><th>RATE</th><th>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.productname}</td>
                    <td>{r.description}</td>
                    <td>{r.quantity}</td>
                    <td>{r.units}</td>
                    <td>{r.rate}</td>
                    <td>{(num(r.quantity) * num(r.rate)).toFixed(2)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} style={{ textAlign: "right", fontWeight: "bold" }}>TOTAL</td>
                  <td style={{ fontWeight: "bold" }}>{total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <button onClick={() => handleApprove(inv)} style={{ marginTop: 10 }}>Approve</button>
          </div>
        );
      })}
    </div>
  );
}

// -------- App Wrapper --------
export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/user/:phonenumber" element={<UserInvoices />} />
        <Route path="*" element={<p>Invalid URL. Use /user/&lt;phonenumber&gt;</p>} />
      </Routes>
    </Router>
  );
}
