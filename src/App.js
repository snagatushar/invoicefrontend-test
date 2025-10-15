import { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const supabaseUrl = "https://begfjxlvjaubnizkvruw.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZ2ZqeGx2amF1Ym5pemt2cnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjM0MzcsImV4cCI6MjA3MTYzOTQzN30.P6s1vWqAhXaNclfQw1NQ8Sj974uQJxAmoYG9mPvpKSQ";
const supabase = createClient(supabaseUrl, supabaseKey);

/* ---------- Helpers ---------- */
const safeParse = (val) => {
  if (!val) return [];
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
};

const num = (v) => {
  const n = parseFloat(String(v || "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

const normalizeRows = (inv) => {
  const p = safeParse(inv.productname);
  const d = safeParse(inv.description);
  const q = safeParse(inv.quantity);
  const u = safeParse(inv.units);
  const r = safeParse(inv.rate);

  const len = Math.max(p.length, d.length, q.length, u.length, r.length);
  return Array.from({ length: len }, (_, i) => ({
    productname: p[i] || "",
    description: d[i] || "",
    quantity: q[i] || "",
    units: u[i] || "",
    rate: r[i] || "",
  })).filter((row) => Object.values(row).some((v) => String(v).trim() !== ""));
};

/* ---------- Main Component ---------- */
export default function App() {
  const [invoices, setInvoices] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  /* ---- Fetch all invoices for phone ---- */
  useEffect(() => {
    const phone = window.location.pathname.replace("/", "").trim();
    if (!phone) return;

    const fetchInvoices = async () => {
      const { data, error } = await supabase
        .from("backend")
        .select("*")
        .eq("phonenumber", phone)
        .order("id", { ascending: false });

      if (error) {
        console.error(error);
      } else {
        setInvoices(data);
      }
    };

    fetchInvoices();
  }, []);

  /* ---- Generate PDF ---- */
  const generatePDFBlob = (invoiceLike) => {
    const rows = normalizeRows(invoiceLike);
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("INVOICE", 105, 20, { align: "center" });

    doc.setFontSize(12);
    doc.text(`Invoice No: ${invoiceLike.invoice_number}`, 20, 40);
    doc.text(`Dealer: ${invoiceLike.Dealer}`, 20, 50);
    doc.text(`Phone: ${invoiceLike.phonenumber}`, 20, 60);
    doc.text(`Date: ${invoiceLike.invoice_date}`, 20, 70);
    doc.text(`Status: ${invoiceLike.status}`, 20, 80);

    let total = 0;
    const body = rows.map((r) => {
      const amt = num(r.quantity) * num(r.rate);
      total += amt;
      return [
        r.productname,
        r.description,
        r.quantity,
        r.units,
        num(r.rate).toFixed(2),
        amt.toFixed(2),
      ];
    });

    autoTable(doc, {
      startY: 95,
      head: [["Product", "Description", "Qty", "Units", "Rate", "Amount"]],
      body: [...body, ["", "", "", "", "Total", total.toFixed(2)]],
      theme: "grid",
    });

    doc.text(
      "Authorized Signature: ___________________",
      20,
      (doc.lastAutoTable?.finalY ?? 120) + 20
    );

    return doc.output("blob");
  };

  /* ---- Approve Invoice ---- */
  const handleApprove = async (inv) => {
    try {
      setLoading(true);
      const rows = normalizeRows(inv);
      const total = rows
        .map((r) => num(r.quantity) * num(r.rate))
        .reduce((a, b) => a + b, 0);

      const pdfBlob = generatePDFBlob({ ...inv, status: "APPROVED" });
      const fileName = `invoice_${inv.id}.pdf`;

      await supabase.storage
        .from("invoices")
        .upload(fileName, pdfBlob, {
          contentType: "application/pdf",
          upsert: true,
        });

      const { data: urlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(fileName);
      const pdfUrl = urlData.publicUrl;

      // Delete approved invoice from DB
      await supabase.from("backend").delete().eq("id", inv.id);

      alert("✅ Approved and deleted from database!");
      setInvoices((prev) => prev.filter((x) => x.id !== inv.id));
    } catch (e) {
      console.error(e);
      alert("❌ Approval failed");
    } finally {
      setLoading(false);
    }
  };

  /* ---- Edit Invoice ---- */
  const handleEdit = (inv) => {
    setEditId(inv.id);
    setEditData({ ...inv, rows: normalizeRows(inv) });
  };

  const handleChangeHeader = (field, value) =>
    setEditData((s) => ({ ...s, [field]: value }));

  const handleRowChange = (i, field, value) =>
    setEditData((s) => {
      const rows = [...s.rows];
      rows[i][field] = value;
      return { ...s, rows };
    });

  const addRow = () =>
    setEditData((s) => ({
      ...s,
      rows: [...s.rows, { productname: "", description: "", quantity: "", units: "", rate: "" }],
    }));

  const removeRow = (i) =>
    setEditData((s) => ({
      ...s,
      rows: s.rows.filter((_, idx) => idx !== i),
    }));

  const calcTotal = useMemo(() => {
    if (!editId) return 0;
    return editData.rows
      .map((r) => num(r.quantity) * num(r.rate))
      .reduce((a, b) => a + b, 0);
  }, [editId, editData]);

  /* ---- Save Invoice ---- */
  const handleSave = async () => {
    try {
      setLoading(true);
      const rows = editData.rows.filter((r) =>
        Object.values(r).some((v) => String(v).trim() !== "")
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
        total: calcTotal,
        status: "DRAFT",
      };

      await supabase.from("backend").update(payload).eq("id", editId);
      alert("💾 Saved!");
      setInvoices((prev) =>
        prev.map((x) => (x.id === editId ? { ...x, ...payload } : x))
      );
      setEditId(null);
    } catch (e) {
      console.error(e);
      alert("❌ Save failed");
    } finally {
      setLoading(false);
    }
  };

  if (invoices.length === 0) return <h3>No invoices found.</h3>;

  return (
    <div style={{ padding: 20 }}>
      <h2>Invoices for Phone</h2>
      {invoices.map((inv) => {
        const rows = normalizeRows(inv);
        const total = rows
          .map((r) => num(r.quantity) * num(r.rate))
          .reduce((a, b) => a + b, 0);

        const isEditing = editId === inv.id;

        return (
          <div key={inv.id} style={{ border: "2px solid #ccc", margin: 20, padding: 15 }}>
            <h3>Invoice #{inv.invoice_number}</h3>
            <p>
              <b>Dealer:</b> {inv.Dealer} <br />
              <b>Date:</b> {inv.invoice_date} <br />
              <b>Status:</b> {inv.status}
            </p>

            <table border="1" cellPadding="6" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Units</th>
                  <th>Rate</th>
                  <th>Amount</th>
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
                  <td colSpan={5} style={{ textAlign: "right", fontWeight: "bold" }}>
                    TOTAL
                  </td>
                  <td>{total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: 10 }}>
              <button onClick={() => handleEdit(inv)}>Edit</button>
              <button
                onClick={() => handleApprove(inv)}
                style={{ marginLeft: 10 }}
              >
                Approve & Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
