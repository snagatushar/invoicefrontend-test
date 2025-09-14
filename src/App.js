// App.jsx
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

const num = (v) => {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
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
    const hasAny = Object.values(row).some(
      (v) => String(v).trim() !== ""
    );
    if (hasAny) rows.push(row);
  }
  return rows;
};

/** -------- Component -------- */
export default function App() {
  const [invoice, setInvoice] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  /** ---- Fetch invoice from URL ---- */
  useEffect(() => {
    const phone = window.location.pathname.replace("/", "").trim();
    if (!phone) return;

    const fetchInvoice = async () => {
      const { data, error } = await supabase
        .from("backend")
        .select("*")
        .eq("phonenumber", phone)
        .single();
      if (error) return console.error(error);

      setInvoice({
        ...data,
        Dealer: (data.Dealer ?? "").toUpperCase(),
        invoice_date: data.invoice_date ?? "",
        status: (data.status ?? "").toUpperCase(),
      });
    };
    fetchInvoice();
  }, []);

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
      const line = num(r.quantity) * num(r.rate);
      total += line;
      return [
        r.productname,
        r.description,
        String(r.quantity),
        r.units,
        num(r.rate).toFixed(2),
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

    doc.text(
      "Authorized Signature: ____________________",
      20,
      (doc.lastAutoTable?.finalY ?? 120) + 20
    );
    return doc.output("blob");
  };

  /** ---- Approve Invoice ---- */
  const handleApprove = async (inv) => {
    try {
      setLoading(true);
      const rows = normalizeRows(inv);
      const total = rows
        .map((r) => num(r.quantity) * num(r.rate))
        .reduce((a, b) => a + b, 0);

      await supabase
        .from("backend")
        .update({ status: "APPROVED", total, amount: total })
        .eq("phonenumber", inv.phonenumber);

      const pdfBlob = generatePDFBlob({ ...inv, status: "APPROVED" });
      const fileName = `invoice_${inv.phonenumber}.pdf`;
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

      await supabase
        .from("backend")
        .update({ pdf_url: pdfUrl })
        .eq("phonenumber", inv.phonenumber);

      await fetch(
        "https://n8n-image2doc-u35379.vm.elestio.app/webhook/f06adee0-b5f2-40f4-a293-4ec1067a14b0",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "invoice_approved",
            invoice_number: inv.invoice_number,
            phonenumber: inv.phonenumber,
            total,
            pdf_url: pdfUrl,
          }),
        }
      );

      setInvoice({ ...inv, status: "APPROVED", pdf_url: pdfUrl });
      setEditId(null);
      alert("✅ Invoice Approved & PDF uploaded!");
    } catch (e) {
      console.error(e);
      alert("❌ Approval failed");
    } finally {
      setLoading(false);
    }
  };

  /** ---- Edit / Save Invoice ---- */
  const handleEdit = () => {
    if (!invoice) return;
    setEditId(invoice.phonenumber);
    setEditData({ ...invoice, rows: normalizeRows(invoice) });
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
      rows: [
        ...s.rows,
        {
          productname: "",
          description: "",
          quantity: "",
          units: "",
          rate: "",
        },
      ],
    }));
  const removeRow = (i) =>
    setEditData((s) => ({
      ...s,
      rows: s.rows.filter((_, idx) => idx !== i),
    }));

  const calcEditTotals = useMemo(() => {
    if (!editId || !editData?.rows) return { total: 0 };
    return {
      total: editData.rows
        .map((r) => num(r.quantity) * num(r.rate))
        .reduce((a, b) => a + b, 0),
    };
  }, [editId, editData]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const rows = (editData.rows || []).filter((r) =>
        Object.values(r).some((v) => String(v).trim() !== "")
      );

      const productname = rows.map((r) => r.productname);
      const description = rows.map((r) => r.description);
      const quantity = rows.map((r) => r.quantity);
      const units = rows.map((r) => r.units);
      const rate = rows.map((r) => r.rate);

      const total = rows
        .map((r) => num(r.quantity) * num(r.rate))
        .reduce((a, b) => a + b, 0);

      const payload = {
        invoice_number: editData.invoice_number ?? "",
        Dealer: editData.Dealer ?? "",
        phonenumber: editData.phonenumber ?? "",
        invoice_date: editData.invoice_date ?? "",
        productname: JSON.stringify(productname),
        description: JSON.stringify(description),
        quantity: JSON.stringify(quantity),
        units: JSON.stringify(units),
        rate: JSON.stringify(rate),
        total,
        amount: total,
        status: "DRAFT",
      };

      await supabase
        .from("backend")
        .update(payload)
        .eq("phonenumber", editId);

      // 🔥 Fix: store invoice in Supabase-like format
      setInvoice({ ...payload });
      setEditId(null);
      alert("💾 Invoice saved!");
    } catch (e) {
      console.error(e);
      alert("❌ Save failed");
    } finally {
      setLoading(false);
    }
  };

  if (!invoice) return <div>Loading...</div>;

  const rows = editId ? editData.rows : normalizeRows(invoice);
  const total = rows
    .map((r) => num(r.quantity) * num(r.rate))
    .reduce((a, b) => a + b, 0);

  return (
    <div style={{ padding: 20, opacity: loading ? 0.6 : 1 }}>
      <h2>Invoice: {invoice.phonenumber}</h2>

      {editId ? (
        <div style={{ display: "grid", gap: 8, maxWidth: 400 }}>
          <label>
            Invoice No:{" "}
            <input
              value={editData.invoice_number}
              onChange={(e) =>
                handleChangeHeader("invoice_number", e.target.value)
              }
            />
          </label>
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
        </div>
      ) : (
        <p>
          <b>Dealer:</b> {invoice.Dealer}
          <br />
          <b>Date:</b> {invoice.invoice_date}
          <br />
          <b>Status:</b> {invoice.status}
        </p>
      )}

      {invoice.pdf_url && (
        <p>
          <a href={invoice.pdf_url} target="_blank" rel="noreferrer">
            📄 View PDF
          </a>
        </p>
      )}

      <table
        border="1"
        cellPadding="6"
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <thead>
          <tr>
            <th>Product</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Units</th>
            <th>Rate</th>
            <th>Amount</th>
            {editId && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const amount = num(r.quantity) * num(r.rate);
            return (
              <tr key={i}>
                {editId ? (
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
              {editId
                ? calcEditTotals.total.toFixed(2)
                : total.toFixed(2)}
            </td>
            {editId && <td />}
          </tr>
        </tbody>
      </table>

      {editId ? (
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
        <>
          <button
            onClick={handleEdit}
            style={{ marginTop: 10, marginRight: 10 }}
          >
            Edit
          </button>
          {invoice.status !== "APPROVED" && (
            <button
              onClick={() => handleApprove(invoice)}
              style={{ marginTop: 10, marginLeft: 10 }}
            >
              Approve
            </button>
          )}
        </>
      )}
    </div>
  );
}
