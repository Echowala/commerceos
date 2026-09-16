"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Order = {
  id: string; orderNumber: string; status: string; paymentStatus: string;
  total: string | number; currency: string; createdAt: string;
  customer?: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null } | null;
  store?: { name: string };
  items: { id: string; name: string; quantity: number; unitPrice: string | number; total: string | number }[];
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => { try { setOrders(await api<Order[]>("/orders")); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load orders"); } finally { setLoading(false); } })(); }, []);

  return <main className="main workspace-page">
    <header className="header"><div><h1 className="title">Orders</h1><div className="muted">Manage orders across your commerce workspace.</div></div><a className="back-link" href="/">Dashboard</a></header>
    <section className="section">
      {loading ? <p className="muted">Loading orders...</p> : error ? <p className="error">{error}</p> : orders.length === 0 ? <p className="muted">No orders yet. Orders created through the API will appear here.</p> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th><th>Date</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><strong>#{o.orderNumber}</strong><div className="muted small">{o.items.length} item{o.items.length === 1 ? "" : "s"}</div></td><td>{o.customer ? [o.customer.firstName, o.customer.lastName].filter(Boolean).join(" ") || o.customer.email || "Customer" : "Guest"}</td><td><span className="badge">{o.status}</span></td><td>{o.paymentStatus}</td><td>{o.currency} {o.total}</td><td>{new Date(o.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
