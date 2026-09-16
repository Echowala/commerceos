"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Customer = { id: string; email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; createdAt: string; orderCount: number; totalSpend: string; lastOrderAt: string | null };
type CustomerDetail = Customer & { averageOrderValue: string; topProducts: { name: string; quantity: number }[]; orders: { id: string; orderNumber: string; status: string; paymentStatus: string; total: string; currency: string; createdAt: string; store: { id: string; name: string }; items: { id: string; name: string; quantity: number; unitPrice: string; total: string }[] }[] };
type Tag = { id: string; name: string; color?: string | null; _count?: { customers: number } };
type Assignment = { tag: Tag };
type Event = { id: string; type: string; data?: { note?: string; orderNumber?: string; from?: string; to?: string } | null; createdAt: string };

const customerName = (customer: Customer) => [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer";
const money = (value: string, currency = "PKR") => `${currency} ${Number(value).toFixed(2)}`;
const eventText = (event: Event) => { if (event.type === "NOTE") return event.data?.note || "Note"; if (event.type === "ORDER_PLACED") return `Order #${event.data?.orderNumber || ""} placed`; if (event.type === "ORDER_STATUS_CHANGED") return `Order #${event.data?.orderNumber || ""}: ${event.data?.from || ""} → ${event.data?.to || ""}`; return event.type.replaceAll("_", " "); };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [assignedTags, setAssignedTags] = useState<Assignment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => { try { const [customerList, tagList] = await Promise.all([api<Customer[]>("/customers"), api<Tag[]>("/crm/tags")]); setCustomers(customerList); setTags(tagList); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load customers"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const openCustomer = async (id: string) => { try { const [detail, customerTags, customerEvents] = await Promise.all([api<CustomerDetail>(`/customers/${id}`), api<Assignment[]>(`/crm/customers/${id}/tags`), api<Event[]>(`/crm/customers/${id}/events`)]); setSelected(detail); setAssignedTags(customerTags); setEvents(customerEvents); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load customer"); } };
  const addTag = async (tagId: string) => { if (!selected || !tagId) return; try { await api(`/crm/customers/${selected.id}/tags`, { method: "POST", body: JSON.stringify({ tagId }) }); setAssignedTags(await api<Assignment[]>(`/crm/customers/${selected.id}/tags`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to add tag"); } };
  const removeTag = async (tagId: string) => { if (!selected) return; try { await api(`/crm/customers/${selected.id}/tags?tagId=${encodeURIComponent(tagId)}`, { method: "DELETE" }); setAssignedTags(await api<Assignment[]>(`/crm/customers/${selected.id}/tags`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to remove tag"); } };
  const addNote = async () => { if (!selected || !note.trim()) return; try { await api(`/crm/customers/${selected.id}/events`, { method: "POST", body: JSON.stringify({ note }) }); setNote(""); setEvents(await api<Event[]>(`/crm/customers/${selected.id}/events`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to add note"); } };

  return <main className="main workspace-page">
    <header className="header"><div><h1 className="title">Customers</h1><div className="muted">Customer 360: identity, orders, spend and CRM activity.</div></div><a className="back-link" href="/">Dashboard</a></header>
    <section className="section">
      {loading ? <p className="muted">Loading customers...</p> : error && !selected ? <p className="error">{error}</p> : customers.length === 0 ? <p className="muted">No customers yet. They will appear here after their first order.</p> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Lifetime spend</th><th>Last order</th></tr></thead><tbody>{customers.map(c => <tr key={c.id} className="clickable-row" onClick={() => void openCustomer(c.id)}><td><strong>{customerName(c)}</strong></td><td>{c.email || c.phone || "—"}</td><td>{c.orderCount}</td><td>{money(c.totalSpend)}</td><td>{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div>}
    </section>
    {selected && <section className="section detail-card">
      <div className="detail-header"><div><h2>{customerName(selected)}</h2><div className="muted">{selected.email || selected.phone || "No contact details"}</div></div><button className="secondary-button" onClick={() => setSelected(null)}>Close</button></div>
      <div className="cards compact"><div className="card"><div className="muted">Orders</div><div className="metric">{selected.orderCount}</div></div><div className="card"><div className="muted">Lifetime spend</div><div className="metric">{money(selected.totalSpend)}</div></div><div className="card"><div className="muted">Average order</div><div className="metric">{money(selected.averageOrderValue)}</div></div><div className="card"><div className="muted">Last order</div><div className="metric">{selected.lastOrderAt ? new Date(selected.lastOrderAt).toLocaleDateString() : "—"}</div></div></div>
      <h3>Tags</h3><div className="tag-list">{assignedTags.map(({ tag }) => <button key={tag.id} className="tag" onClick={() => void removeTag(tag.id)}>{tag.name} ×</button>)}<select defaultValue="" onChange={e => { void addTag(e.target.value); e.currentTarget.value = ""; }}><option value="" disabled>Add tag…</option>{tags.filter(tag => !assignedTags.some(a => a.tag.id === tag.id)).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>
      <div className="detail-grid"><div><h3>Top products</h3>{selected.topProducts.length === 0 ? <p className="muted">No completed purchase data yet.</p> : selected.topProducts.map(product => <div className="product-row" key={product.name}><strong>{product.name}</strong><span className="muted">{product.quantity} units</span></div>)}<h3>Order history</h3>{selected.orders.length === 0 ? <p className="muted">No orders.</p> : selected.orders.map(o => <div className="product-row" key={o.id}><div><strong>#{o.orderNumber}</strong><div className="muted">{o.store.name} · {o.status} · {o.paymentStatus}</div></div><span>{money(o.total, o.currency)}</span></div>)}</div><div><h3>Activity timeline</h3><div className="note-row"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a customer note…" maxLength={2000} /><button className="secondary-button" onClick={() => void addNote()}>Add note</button></div>{events.length === 0 ? <p className="muted">No activity yet.</p> : events.map(event => <div className="product-row" key={event.id}><div><strong>{eventText(event)}</strong><div className="muted">{event.type.replaceAll("_", " ")} · {new Date(event.createdAt).toLocaleString()}</div></div></div>)}</div></div>
      {error && <p className="error">{error}</p>}
    </section>}
  </main>;
}
