"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: string | number;
  total: string | number;
  currency: string;
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  createdAt: string;
  customer?: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
  store?: { id: string; name: string; currency: string } | null;
  items: { id: string; name: string; quantity: number; unitPrice: string | number; total: string | number }[];
};

const statuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const result = await api<Order>(`/orders/${params.id}`);
      setOrder(result);
      setStatus(result.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load order");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [params.id]);

  const updateStatus = async () => {
    if (!order || status === order.status) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ status: string }>(`/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setOrder(current => current ? { ...current, status: result.status } : current);
    } catch (e) {
      setStatus(order.status);
      setError(e instanceof Error ? e.message : "Unable to update order");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="main workspace-page"><p className="muted">Loading order...</p></main>;
  if (!order) return <main className="main workspace-page"><p className="error">{error || "Order not found"}</p><a className="back-link" href="/orders">Back to orders</a></main>;

  const customerName = order.customer
    ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(" ") || order.customer.email || "Customer"
    : "Guest";

  return (
    <main className="main workspace-page">
      <header className="header">
        <div>
          <a className="back-link" href="/orders">← Orders</a>
          <h1 className="title">Order #{order.orderNumber}</h1>
          <div className="muted">{new Date(order.createdAt).toLocaleString()} · {order.store?.name ?? "Store"}</div>
        </div>
        <div className="status-select">
          <select value={status} disabled={saving} onChange={e => setStatus(e.target.value)}>
            {statuses.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <button className="checkout-button" disabled={saving || status === order.status} onClick={() => void updateStatus()}>
            {saving ? "Saving…" : "Update status"}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="cards">
        <div className="card"><div className="muted">Order total</div><div className="metric">{order.currency} {order.total}</div></div>
        <div className="card"><div className="muted">Payment</div><div className="metric">{order.paymentStatus}</div><small className="muted">{order.paymentMethod}</small></div>
        <div className="card"><div className="muted">Customer</div><div className="metric">{customerName}</div><small className="muted">{order.customer?.email ?? "Guest checkout"}</small></div>
      </div>

      <section className="section">
        <div className="detail-header"><div><h2>Items</h2><p className="muted">{order.items.length} line item{order.items.length === 1 ? "" : "s"}</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
            <tbody>{order.items.map(item => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.quantity}</td>
                <td>{order.currency} {item.unitPrice}</td>
                <td>{order.currency} {item.total}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}><strong>Subtotal</strong></td><td><strong>{order.currency} {order.subtotal}</strong></td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="detail-header"><div><h2>Customer & shipping</h2><p className="muted">Fulfillment information captured with the order.</p></div></div>
        <div className="quick-grid">
          <div className="card"><strong>{customerName}</strong><span>{order.customer?.phone ?? order.shippingPhone}</span><span>{order.customer?.email ?? "No email"}</span></div>
          <div className="card"><strong>{order.shippingName || "Shipping recipient"}</strong><span>{order.shippingPhone || "No phone"}</span><span>{order.shippingAddress || "No shipping address"}</span></div>
        </div>
      </section>
    </main>
  );
}
