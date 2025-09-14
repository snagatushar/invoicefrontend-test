import { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const supabaseUrl = "https://begfjxlvjaubnizkvruw.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZ2ZqeGx2amF1Ym5pemt2cnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjM0MzcsImV4cCI6MjA3MTYzOTQzN30.P6s1vWqAhXaNclfQw1NQ8Sj974uQJxAmoYG9mPvpKSQ"; // replace with your Supabase anon key
const supabase = createClient(supabaseUrl, supabaseKey);

/** -------- Helpers -------- */
const safeParse = (val) => {
  if (!val) return [];
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
  }
  if (Array.isArray(val)) return val;
  return [];
};

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
    const hasAny = row.productname || row.description || row.quantity || row.units || row.rate;
    if (hasAny) rows.push(row);
  }
  return rows;
};

/** -------- Home Page: List Users -------- */
function Home() {
  const [users, setUsers] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchUsers() {
      const { data, error } = await supabase.from("backend").select("phonenumber").neq("phonenumber", null);
      if (error) { console.error(error); return; }
      setUsers(data);
    }
    fetchUsers();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Users</h2>
      {users.map((u, idx) => (
        <div key={idx} style={{ marginBottom: 10 }}>
          <button onClick={() => navigate(`/user/${u.phonenumber}`)}>
            Open invoices for {u.phonenumber}
          </button>
        </div>
      ))}
    </div>
  );
}

/** -------- User Invoices -------- */
function UserInvoices() {
  const { phonenumber } = useParams();
  const [invoices, setInvoices] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  /** Fetch invoices for this user */
  const fetchData = async () => {
    const { data, error } = await supabase.from("backend").select("*").eq("phonenumber", phonenumber);
    if (error) { console.error(error); return; }
    setInvoices(data);
  };

  useEffect(() => { fetchData(); }, [phonenumber]);

  /** Generate PDF blob */
  const generatePDFBlob = (invoice) => {
    const rows = normalizeRows(invoice);
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text("INVOICE", 105, 20, { align: "center" });
    doc.setFontSize(12);
    doc.text(`Invoice No: ${invoice.invoice_number ?? ""}`, 20, 40);
    doc.text(`Dealer: ${invoice.Dealer ?? ""}`, 20, 50);
    doc.text(`Phone: ${invoice.phonenumber ?? ""}`, 20, 60);
    doc.text(`Date: ${invoice.invoice_date ?? ""}`, 20, 70);
    doc.text(`Status: ${invoice.status ?? ""}`, 20, 80);

    let total = 0;
    const tableData = rows.map(r => {
      const qty = num(r.quantity); const rate = num(r.rate); const line = qty * rate;
      total += line;
      return [r.productname, r.description, String(qty), r.units, rate.toFixed(2), line.toFixed(2)];
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

  /** Approve Invoice & Upload PDF + Trigger Webhook */
  const handleApprove = async (invoice) => {
    try {
      setLoading(true);
      const rows = normalizeRows(invoice);
      const total = rows.map(r => num(r.quantity) * num(r.rate)).reduce((a,b)=>a+b,0);

      // Update invoice status
      const { error: updateError } = await supabase
        .from("backend")
        .update({ status: "APPROVED", total, amount: total })
        .eq("phonenumber", invoice.phonenumber)
        .eq("invoice_number", invoice.invoice_number);
      if (updateError) throw updateError;

      // Generate PDF
      const pdfBlob = generatePDFBlob({ ...invoice, status: "APPROVED" });
      const fileName = `invoice_${invoice.phonenumber}_${invoice.invoice_number}.pdf`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(fileName);
      const pdfUrl = urlData.publicUrl;

      // Update invoice record with PDF URL
      const { error: urlError } = await supabase
        .from("backend")
        .update({ pdf_url: pdfUrl })
        .eq("phonenumber", invoice.phonenumber)
        .eq("invoice_number", invoice.invoice_number);
      if (urlError) throw urlError;

      // Trigger webhook
      await fetch("https://n8n-image2doc-u35379.vm.elestio.app/webhook-test/f06adee0-b5f2-40f4-a293-4ec1067a14b0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_number: invoice.invoice_number, phonenumber: invoice.phonenumber })
      });

      alert("✅ Approved, PDF uploaded & webhook triggered!");
      fetchData();
    } catch (e) {
      console.error(e); alert("❌ Approve failed.");
    } finally { setLoading(false); }
  };

  /** Edit Invoice (optional, simplified) */
  const handleEdit = (invoice) => {
    setEditId(invoice.invoice_number);
    setEditData(invoice);
  };

  /** Save Edited Invoice */
  const handleSave = async () => {
    try {
      setLoading(true);
      await supabase
        .from("backend")
        .update({ ...editData, status: "DRAFT" })
        .eq("invoice_number", editId)
        .eq("phonenumber", phonenumber);
      alert("💾 Saved!");
      setEditId(null); setEditData({});
      fetchData();
    } catch (e) { console.error(e); alert("❌ Save failed"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ padding: 20, opacity: loading ? 0.6 : 1 }}>
      <h2>Invoices for {phonenumber}</h2>
      {invoices.length === 0 && <p>No invoices found.</p>}

      {invoices.map(inv => {
        const rows = normalizeRows(inv);
        const total = rows.map(r => num(r.quantity)*num(r.rate)).reduce((a,b)=>a+b,0);
        const isEditing = editId === inv.invoice_number;

        return (
          <div key={inv.invoice_number} style={{ border: "2px solid #222", marginBottom: 20, padding: 12, borderRadius: 8 }}>
            <h3>INVOICE: {isEditing ? <input value={editData.invoice_number} onChange={e => setEditData({...editData, invoice_number: e.target.value})} /> : inv.invoice_number}</h3>

            <p>
              <b>DEALER:</b> {inv.Dealer}<br/>
              <b>PHONE:</b> {inv.phonenumber}<br/>
              <b>DATE:</b> {inv.invoice_date}<br/>
              <b>STATUS:</b> {inv.status}<br/>
              {inv.pdf_url && <a href={inv.pdf_url} target="_blank" rel="noreferrer">📄 View PDF</a>}
            </p>

            {isEditing ? (
              <>
                <button onClick={handleSave}>Save</button>
              </>
            ) : (
              <>
                <button onClick={() => handleEdit(inv)} style={{ marginRight: 10 }}>Edit</button>
                <button onClick={() => handleApprove(inv)}>Approve</button>
              </>
            )}
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
        <Route path="/" element={<Home />} />
        <Route path="/user/:phonenumber" element={<UserInvoices />} />
        <Route path="*" element={<p>Invalid URL. Use /user/&lt;phonenumber&gt;</p>} />
      </Routes>
    </Router>
  );
}
