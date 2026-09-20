"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type AuditLog = {
  id: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
};
type AuditResponse = { items: AuditLog[]; page: number; limit: number; total: number; pages: number };

const formatMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata) return "—";
  const entries = Object.entries(metadata).filter(([key]) => !/password|token|secret|authorization|payment/i.test(key));
  if (!entries.length) return "—";
  return entries.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ");
};

export default function AuditLogsPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  const load = async (targetPage = page) => {
    try {
      setError("");
      const params = new URLSearchParams({ page: String(targetPage), limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      if (action) params.set("action", action);
      if (resource) params.set("resource", resource);
      setData(await api<AuditResponse>(`/audit-logs?${params.toString()}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load audit history");
    }
  };

  useEffect(() => { void load(1); }, [action, resource]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    void load(1);
  };

  return <main className="dashboard"><aside className="sidebar"><div className="brand">CommerceOS</div><nav className="nav"><a href="/">Overview</a><a href="/orders">Orders</a><a href="/customers">Customers</a><a href="/segments">Segments</a><a href="/products">Products</a><a href="/inventory">Inventory</a><a className="active" href="/audit-logs">Audit logs</a><a href="/automations">Automations</a><span>Analytics</span><span>Settings</span></nav></aside><section className="main"><header className="header"><div><h1 className="title">Audit history</h1><div className="muted">Tenant-scoped operational history for sensitive commerce changes.</div></div></header>{error && <p className="error">{error}</p>}<section className="section"><form className="segment-form" onSubmit={submit}><label>Search<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Action, resource or ID" maxLength={120}/></label><label>Resource<select value={resource} onChange={e => setResource(e.target.value)}><option value="">All resources</option><option>Store</option><option>Product</option><option>Customer</option><option>Order</option><option>ProductVariant</option><option>Automation</option><option>CustomerTag</option><option>CustomerSegment</option><option>User</option></select></label><label>Action<input value={action} onChange={e => setAction(e.target.value)} placeholder="e.g. ORDER_CREATED" maxLength={100}/></label><button className="primary-button" type="submit">Filter</button></form></section><section className="section"><div className="detail-header"><div><h2>Events</h2><p className="muted">{data?.total ?? 0} recorded event{data?.total === 1 ? "" : "s"}.</p></div></div>{data?.items.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Resource</th><th>User</th><th>Details</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td><span className="badge">{item.action}</span></td><td>{item.resource}{item.resourceId ? <><br/><small className="muted">{item.resourceId}</small></> : null}</td><td>{item.userId ?? "System"}</td><td className="audit-detail">{formatMetadata(item.metadata)}</td></tr>)}</tbody></table></div> : <p className="muted">No audit events match these filters.</p>}<div className="detail-header"><button className="secondary-button" disabled={!data || page <= 1} onClick={() => { const next = page - 1; setPage(next); void load(next); }}>Previous</button><span className="muted">Page {data?.page ?? page} of {data?.pages ?? 1}</span><button className="secondary-button" disabled={!data || page >= (data?.pages ?? 1)} onClick={() => { const next = page + 1; setPage(next); void load(next); }}>Next</button></div></section></section></main>;
}
