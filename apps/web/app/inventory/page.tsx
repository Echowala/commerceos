"use client";

import { useEffect, useState } from "react";
import { api, clearToken } from "../../lib/api";

type Item = {
  id: string;
  sku: string;
  stock: number;
  price: string;
  availability: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  product: { id: string; name: string; status: string; store: { id: string; name: string; currency: string } };
};
type InventoryResponse = { threshold: number; summary: { skus: number; units: number; lowStock: number; outOfStock: number }; items: Item[] };
type Movement = { id: string; type: string; quantity: number; stockBefore: number; stockAfter: number; reason: string | null; createdAt: string };

export default function InventoryPage() {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [type, setType] = useState("ADJUSTMENT");
  const [reason, setReason] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await api<InventoryResponse>("/inventory?lowStock=5")); setError(""); }
    catch (e) { if (String(e).includes("401")) clearToken(); setError(e instanceof Error ? e.message : "Unable to load inventory"); }
  };
  useEffect(() => { load(); }, []);

  const openHistory = async (item: Item) => {
    setSelected(item);
    try { const result = await api<{ variant: { id: string; sku: string; product: { name: string } }; movements: Movement[] }>(`/inventory/${item.id}/movements`); setMovements(result.movements); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load movement history"); }
  };

  const adjust = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed === 0) { setError("Quantity must be a non-zero integer"); return; }
    const signed = type === "DAMAGE" ? -Math.abs(parsed) : parsed;
    setBusy(true); setError("");
    try {
      await api(`/inventory/${selected.id}/adjust`, { method: "POST", body: JSON.stringify({ quantity: signed, type: type === "DAMAGE" ? "ADJUSTMENT" : type, reason }) });
      setQuantity("1"); setReason(""); await load(); await openHistory({ ...selected, stock: selected.stock + signed });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to adjust stock"); }
    finally { setBusy(false); }
  };

  if (!data) return <main className="dashboard-shell"><section className="dashboard-main"><div className="page-card">{error ? <p className="form-error">{error}</p> : "Loading inventory…"}</div></section></main>;

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar"><div className="brand">CommerceOS</div><nav><a href="/">Overview</a><a href="/orders">Orders</a><a href="/customers">Customers</a><a href="/products">Products</a><a className="active" href="/inventory">Inventory</a><span>Analytics</span><span>Automations</span><span>Settings</span></nav></aside>
    <section className="dashboard-main">
      <header className="dashboard-header"><div><p className="eyebrow">Operations</p><h1>Inventory Intelligence</h1><p>Live stock visibility, adjustments and movement history.</p></div></header>
      {error && <div className="form-error">{error}</div>}
      <div className="stats-grid">
        <div className="stat-card"><span>SKUs</span><strong>{data.summary.skus}</strong></div>
        <div className="stat-card"><span>Inventory units</span><strong>{data.summary.units}</strong></div>
        <div className="stat-card"><span>Low stock</span><strong>{data.summary.lowStock}</strong></div>
        <div className="stat-card"><span>Out of stock</span><strong>{data.summary.outOfStock}</strong></div>
      </div>
      <div className="page-card">
        <div className="section-heading"><div><h2>Stock levels</h2><p>Low stock threshold: ≤ {data.threshold} units.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Store</th><th>Stock</th><th>Availability</th><th /></tr></thead><tbody>
          {data.items.map(item => <tr key={item.id}><td><strong>{item.product.name}</strong></td><td>{item.sku}</td><td>{item.product.store.name}</td><td>{item.stock}</td><td><span className={`status-pill ${item.availability.toLowerCase()}`}>{item.availability.replaceAll("_", " ")}</span></td><td><button className="secondary-button" onClick={() => openHistory(item)}>Manage</button></td></tr>)}
          {!data.items.length && <tr><td colSpan={6}>No inventory items yet.</td></tr>}
        </tbody></table></div>
      </div>
      {selected && <div className="inventory-grid">
        <section className="page-card"><div className="section-heading"><div><h2>Adjust stock</h2><p>{selected.product.name} · {selected.sku} · Current {selected.stock}</p></div><button className="secondary-button" onClick={() => setSelected(null)}>Close</button></div>
          <form className="auth-form" onSubmit={adjust}><label>Movement<select value={type} onChange={e => setType(e.target.value)}><option value="ADJUSTMENT">Adjustment / add</option><option value="RESTOCK">Restock</option><option value="RETURN">Return</option><option value="DAMAGE">Damage / remove</option></select></label><label>Quantity<input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label>Reason<input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. supplier delivery" /></label><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Update stock"}</button></form>
        </section>
        <section className="page-card"><div className="section-heading"><div><h2>Movement history</h2><p>Latest 100 movements for this SKU.</p></div></div><div className="movement-list">{movements.map(m => <div className="movement-row" key={m.id}><div><strong>{m.type}</strong><small>{m.reason || "No reason"}</small></div><div className={m.quantity > 0 ? "movement-positive" : "movement-negative"}>{m.quantity > 0 ? "+" : ""}{m.quantity}</div><div><small>{m.stockBefore} → {m.stockAfter}</small></div></div>)}{!movements.length && <p>No movements recorded yet.</p>}</div></section>
      </div>}
    </section>
  </main>;
}
