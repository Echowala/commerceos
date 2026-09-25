"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Customer = { id: string; email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; createdAt: string; orderCount: number; totalSpend: string; lastOrderAt: string | null };
type CustomerOrder = { id: string; orderNumber: string; status: string; paymentStatus: string; total: string; currency: string; createdAt: string; store: { id: string; name: string }; items: { id: string; name: string; quantity: number; unitPrice: string; total: string }[] };
type CustomerDetail = Customer & { averageOrderValue: string; topProducts: { name: string; quantity: number }[]; orders: CustomerOrder[]; orderTotal: number; orderPage: number; orderPageSize: number; orderTotalPages: number };
type Tag = { id: string; name: string; color?: string | null; _count?: { customers: number } };
type Assignment = { tag: Tag };
type Event = { id: string; type: string; data?: { note?: string; orderNumber?: string; from?: string; to?: string } | null; createdAt: string };
type ProfileForm = { firstName: string; lastName: string; email: string; phone: string };
type CustomerListResponse = { items: Customer[]; total: number; page: number; pageSize: number; totalPages: number };

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
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [profile, setProfile] = useState<ProfileForm>({ firstName: "", lastName: "", email: "", phone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotalPages, setOrderTotalPages] = useState(1);
  const pageSize = 25;
  const orderPageSize = 10;

  const load = async (targetPage = page) => { try { const [customerList, tagList] = await Promise.all([api<CustomerListResponse>(`/customers?page=${targetPage}&pageSize=${pageSize}`), api<Tag[]>("/crm/tags")]); setCustomers(customerList.items); setPage(customerList.page); setTotalPages(customerList.totalPages); setTags(tagList); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load customers"); } finally { setLoading(false); } };
  useEffect(() => { void load(page); }, [page]);
  const openCustomer = async (id: string, targetOrderPage = 1) => { try { const [detail, customerTags, customerEvents] = await Promise.all([api<CustomerDetail>(`/customers/${id}?orderPage=${targetOrderPage}&orderPageSize=${orderPageSize}`), api<Assignment[]>(`/crm/customers/${id}/tags`), api<Event[]>(`/crm/customers/${id}/events`)]); setSelected(detail); setOrderPage(detail.orderPage); setOrderTotalPages(detail.orderTotalPages); setProfile({ firstName: detail.firstName ?? "", lastName: detail.lastName ?? "", email: detail.email ?? "", phone: detail.phone ?? "" }); setAssignedTags(customerTags); setEvents(customerEvents); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load customer"); } };
  const saveProfile = async () => { if (!selected) return; setSavingProfile(true); try { const updated = await api<Customer>(`/customers/${selected.id}`, { method: "PATCH", body: JSON.stringify(profile) }); setSelected(current => current ? { ...current, ...updated } : current); setCustomers(current => current.map(customer => customer.id === updated.id ? { ...customer, ...updated } : customer)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to save customer"); } finally { setSavingProfile(false); } };
  const createTag = async () => { const name = tagName.trim(); if (!name || creatingTag) return; setCreatingTag(true); try { const created = await api<Tag>("/crm/tags", { method: "POST", body: JSON.stringify({ name, color: tagColor.trim() || undefined }) }); setTags(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name))); setTagName(""); setTagColor(""); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create tag"); } finally { setCreatingTag(false); } };
  const addTag = async (tagId: string) => { if (!selected || !tagId) return; try { await api(`/crm/customers/${selected.id}/tags`, { method: "POST", body: JSON.stringify({ tagId }) }); setAssignedTags(await api<Assignment[]>(`/crm/customers/${selected.id}/tags`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to add tag"); } };
  const removeTag = async (tagId: string) => { if (!selected) return; try { await api(`/crm/customers/${selected.id}/tags?tagId=${encodeURIComponent(tagId)}`, { method: "DELETE" }); setAssignedTags(await api<Assignment[]>(`/crm/customers/${selected.id}/tags`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to remove tag"); } };
  const addNote = async () => { if (!selected || !note.trim()) return; try { await api(`/crm/customers/${selected.id}/events`, { method: "POST", body: JSON.stringify({ note }) }); setNote(""); setEvents(await api<Event[]>(`/crm/customers/${selected.id}/events`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to add note"); } };

  return <main className="main workspace-page">
    <header className="header"><div><h1 className="title">Customers</h1><div className="muted">Customer 360: identity, orders, spend and CRM activity.</div></div><a className="back-link" href="/">Dashboard</a></header>
    <section className="section">
      {loading ? <p className="muted">Loading customers...</p> : error && !selected ? <p className="error">{error}</p> : customers.length === 0 ? <p className="muted">No customers yet. They will appear here after their first order.</p> : <>
        <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Lifetime spend</th><th>Last order</th></tr></thead><tbody>{customers.map(c => <tr key={c.id} className="clickable-row" onClick={() => void openCustomer(c.id)}><td><strong>{customerName(c)}</strong></td><td>{c.email || c.phone || "—"}</td><td>{c.orderCount}</td><td>{money(c.totalSpend)}</td><td>{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div>
        {totalPages > 1 && <div className="detail-header"><span className="muted">Page {page} of {totalPages}</span><div className="tag-list"><button className="secondary-button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1}>Previous</button><button className="secondary-button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</button></div></div>}
      </>}
    </section>
    {selected && <section className="section detail-card">
      <div className="detail-header"><div><h2>{customerName(selected)}</h2><div className="muted">{selected.email || selected.phone || "No contact details"}</div></div><button className="secondary-button" onClick={() => setSelected(null)}>Close</button></div>
      <div className="cards compact"><div className="card"><div className="muted">Orders</div><div className="metric">{selected.orderCount}</div></div><div className="card"><div className="muted">Lifetime spend</div><div className="metric">{money(selected.totalSpend)}</div></div><div className="card"><div className="muted">Average order</div><div className="metric">{money(selected.averageOrderValue)}</div></div><div className="card"><div className="muted">Last order</div><div className="metric">{selected.lastOrderAt ? new Date(selected.lastOrderAt).toLocaleDateString() : "—"}</div></div></div>
      <h3>Customer profile</h3><div className="detail-grid"><div><label>First name<input value={profile.firstName} onChange={e => setProfile({ ...profile, firstName: e.target.value })} maxLength={120} /></label><label>Last name<input value={profile.lastName} onChange={e => setProfile({ ...profile, lastName: e.target.value })} maxLength={120} /></label></div><div><label>Email<input type="email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} maxLength={320} /></label><label>Phone<input value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} maxLength={40} /></label></div></div><button className="secondary-button" onClick={() => void saveProfile()} disabled={savingProfile}>{savingProfile ? "Saving..." : "Save profile"}</button>
      <h3>Tags</h3><div className="tag-list">{assignedTags.map(({ tag }) => <button key={tag.id} className="tag" onClick={() => void removeTag(tag.id)}>{tag.name} ×</button>)}<select defaultValue="" onChange={e => { void addTag(e.target.value); e.currentTarget.value = ""; }}><option value="" disabled>Add tag…</option>{tags.filter(tag => !assignedTags.some(a => a.tag.id === tag.id)).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>
      <div className="detail-grid"><div><h3>Top products</h3>{selected.topProducts.length === 0 ? <p className="muted">No completed purchase data yet.</p> : selected.topProducts.map(product => <div className="product-row" key={product.name}><strong>{product.name}</strong><span className="muted">{product.quantity} units</span></div>)}<h3>Order history</h3>{selected.orderTotal === 0 ? <p className="muted">No orders.</p> : <><div>{selected.orders.map(o => <div className="product-row" key={o.id}><div><strong>#{o.orderNumber}</strong><div className="muted">{o.store.name} · {o.status} · {o.paymentStatus}</div></div><span>{money(o.total, o.currency)}</span></div>)}</div>{orderTotalPages > 1 && <div className="detail-header"><span className="muted">Page {orderPage} of {orderTotalPages}</span><div className="tag-list"><button className="secondary-button" onClick={() => void openCustomer(selected.id, orderPage - 1)} disabled={orderPage === 1}>Previous</button><button className="secondary-button" onClick={() => void openCustomer(selected.id, orderPage + 1)} disabled={orderPage === orderTotalPages}>Next</button></div></div>}</>}</div><div><h3>Activity timeline</h3><div className="note-row"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a customer note…" maxLength={2000} /><button className="secondary-button" onClick={() => void addNote()}>Add note</button></div>{events.length === 0 ? <p className="muted">No activity yet.</p> : events.map(event => <div className="product-row" key={event.id}><div><strong>{eventText(event)}</strong><div className="muted">{event.type.replaceAll("_", " ")} · {new Date(event.createdAt).toLocaleString()}</div></div></div>)}</div></div>
    </section>}
    <section className="section">
      <div className="detail-header"><div><h2>Tag library</h2><div className="muted">Create reusable CRM tags for manual assignment and future automation rules.</div></div></div>
      <div className="note-row"><input value={tagName} onChange={e => setTagName(e.target.value)} placeholder="Tag name" maxLength={80} onKeyDown={e => { if (e.key === "Enter") void createTag(); }} /><input value={tagColor} onChange={e => setTagColor(e.target.value)} placeholder="Color (optional)" maxLength={32} /><button className="secondary-button" onClick={() => void createTag()} disabled={!tagName.trim() || creatingTag}>{creatingTag ? "Creating..." : "Create tag"}</button></div>
      {tags.length > 0 && <div className="tag-list">{tags.map(tag => <span className="tag" key={tag.id}>{tag.name}{tag._count ? ` · ${tag._count.customers}` : ""}</span>)}</div>}
    </section>
  </main>;
}
