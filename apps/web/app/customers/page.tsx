"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Customer = { id: string; email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; createdAt: string; orderCount?: number; totalSpend?: string | number };

type CustomerDetail = Customer & { orders: { id: string; orderNumber: string; status: string; paymentStatus: string; total: string | number; currency: string; createdAt: string }[] };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => { try { setCustomers(await api<Customer[]>("/customers")); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load customers"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const openCustomer = async (id: string) => { try { setSelected(await api<CustomerDetail>(`/customers/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load customer"); } };

  return <main className="main workspace-page">
    <header className="header"><div><h1 className="title">Customers</h1><div className="muted">Customer 360: identity, orders and lifetime spend.</div></div><a className="back-link" href="/">Dashboard</a></header>
    <section className="section">
      {loading ? <p className="muted">Loading customers...</p> : error ? <p className="error">{error}</p> : customers.length === 0 ? <p className="muted">No customers yet. They will appear here after their first order.</p> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Lifetime spend</th><th>Joined</th></tr></thead><tbody>{customers.map(c => <tr key={c.id} className="clickable-row" onClick={() => void openCustomer(c.id)}><td><strong>{[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed customer"}</strong></td><td>{c.email || c.phone || "—"}</td><td>{c.orderCount ?? 0}</td><td>PKR {c.totalSpend ?? "0"}</td><td>{new Date(c.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}
    </section>
    {selected && <section className="section detail-card"><div className="detail-header"><div><h2>{[selected.firstName, selected.lastName].filter(Boolean).join(" ") || "Unnamed customer"}</h2><div className="muted">{selected.email || selected.phone || "No contact details"}</div></div><button className="secondary-button" onClick={() => setSelected(null)}>Close</button></div><div className="cards compact"><div className="card"><div className="muted">Orders</div><div className="metric">{selected.orders.length}</div></div><div className="card"><div className="muted">Lifetime spend</div><div className="metric">PKR {selected.totalSpend ?? "0"}</div></div></div><h3>Order history</h3>{selected.orders.length === 0 ? <p className="muted">No orders.</p> : selected.orders.map(o => <div className="product-row" key={o.id}><strong>#{o.orderNumber}</strong><span className="muted">{o.status} · {o.currency} {o.total} · {new Date(o.createdAt).toLocaleDateString()}</span></div>)}</section>}
  </main>;
}
