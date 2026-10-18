"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

type Endpoint = { id: string; name: string; url: string; events: unknown; status: string; createdAt: string; updatedAt: string };
type Delivery = { id: string; endpointId: string; endpoint: { name: string }; eventId: string; eventType: string; status: string; attempts: number; availableAt: string; deliveredAt: string | null; lastError: string | null; createdAt: string };
type DeliveryResponse = { items: Delivery[]; total: number; page: number; limit: number; totalPages: number };
const eventOptions = ["ORDER_PLACED", "ORDER_STATUS_CHANGED", "CUSTOMER_CREATED", "INVENTORY_LOW"];

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(["ORDER_PLACED", "ORDER_STATUS_CHANGED"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSecret, setEditSecret] = useState("");
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [updatingId, setUpdatingId] = useState("");

  const loadEndpoints = useCallback(async () => {
    setEndpoints(await api<Endpoint[]>("/webhooks"));
  }, []);
  const loadDeliveries = useCallback(async () => {
    const query = new URLSearchParams({ limit: "50", page: "1" });
    if (status) query.set("status", status);
    const response = await api<DeliveryResponse>(`/webhooks/deliveries?${query.toString()}`);
    setDeliveries(response.items);
    setTotal(response.total);
  }, [status]);

  useEffect(() => {
    void Promise.all([loadEndpoints(), loadDeliveries()]).catch(e => setError(e instanceof Error ? e.message : "Unable to load webhooks"));
  }, [loadEndpoints, loadDeliveries]);

  const createEndpoint = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      await api<Endpoint>("/webhooks", { method: "POST", body: JSON.stringify({ name: name.trim(), url: url.trim(), secret: secret.trim(), events }) });
      setName(""); setUrl(""); setSecret("");
      setNotice("Webhook endpoint created. The signing secret is not shown again, so store it securely.");
      await loadEndpoints();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create endpoint");
    } finally { setSaving(false); }
  };

  const removeEndpoint = async (endpoint: Endpoint) => {
    if (!window.confirm(`Delete webhook endpoint “${endpoint.name}”? Its delivery history will also be removed.`)) return;
    setError(""); setNotice("");
    try {
      await api<{ deleted: boolean }>(`/webhooks/${endpoint.id}`, { method: "DELETE" });
      setNotice("Webhook endpoint deleted.");
      await Promise.all([loadEndpoints(), loadDeliveries()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete endpoint"); }
  };

  const beginEdit = (endpoint: Endpoint) => {
    setEditingId(endpoint.id); setEditName(endpoint.name); setEditUrl(endpoint.url);
    setEditSecret(""); setEditEvents(Array.isArray(endpoint.events) ? endpoint.events.map(String) : []);
    setError(""); setNotice("");
  };

  const toggleEditEvent = (eventName: string) => setEditEvents(current => current.includes(eventName) ? current.filter(item => item !== eventName) : [...current, eventName]);

  const updateEndpoint = async (event: React.FormEvent, endpoint: Endpoint) => {
    event.preventDefault();
    setUpdatingId(endpoint.id); setError(""); setNotice("");
    try {
      await api<Endpoint>(`/webhooks/${endpoint.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim(), url: editUrl.trim(), events: editEvents, ...(editSecret.trim() ? { secret: editSecret.trim() } : {}) }),
      });
      setEditingId(""); setEditSecret("");
      setNotice("Webhook endpoint updated. A replacement signing secret is never returned by the API.");
      await loadEndpoints();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update endpoint"); }
    finally { setUpdatingId(""); }
  };

  const toggleEndpointStatus = async (endpoint: Endpoint) => {
    const nextStatus = endpoint.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setError(""); setNotice("");
    try {
      await api<Endpoint>(`/webhooks/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      setNotice(nextStatus === "PAUSED" ? "Endpoint paused. New deliveries and queued delivery attempts are on hold." : "Endpoint activated.");
      await loadEndpoints();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to change endpoint status"); }
  };

  const retryDelivery = async (delivery: Delivery) => {
    setRetryingId(delivery.id); setError(""); setNotice("");
    try {
      await api<{ queued: boolean }>(`/webhooks/deliveries/${delivery.id}/retry`, { method: "POST" });
      setNotice("Failed delivery queued for a fresh attempt.");
      await loadDeliveries();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to retry delivery"); }
    finally { setRetryingId(""); }
  };

  const toggleEvent = (eventName: string) => setEvents(current => current.includes(eventName) ? current.filter(item => item !== eventName) : [...current, eventName]);

  return (
    <main className="dashboard">
      <aside className="sidebar"><div className="brand">CommerceOS</div><nav className="nav">
        <a href="/">Overview</a><a href="/stores">Stores</a><a href="/orders">Orders</a><a href="/customers">Customers</a><a href="/segments">Segments</a><a href="/products">Products</a><a href="/inventory">Inventory</a><a href="/analytics">Analytics</a><a href="/audit-logs">Audit logs</a><a href="/automations">Automations</a><a className="active" href="/webhooks">Webhooks</a>
      </nav></aside>
      <section className="main">
        <header className="header"><div><h1 className="title">Webhooks</h1><div className="muted">Manage HTTPS endpoints and inspect delivery attempts.</div></div></header>
        {error && <p className="error">{error}</p>}
        {notice && <p className="webhook-notice">{notice}</p>}
        <div className="automation-layout">
          <section className="section">
            <h2>Create endpoint</h2><p className="muted">Events are signed with your secret using HMAC-SHA256. The secret is only collected at creation.</p>
            <form className="segment-form" onSubmit={createEndpoint}>
              <label>Name<input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Order sync" required /></label>
              <label>HTTPS endpoint URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/hooks/commerce" required /></label>
              <label>Signing secret<input value={secret} onChange={e => setSecret(e.target.value)} type="password" autoComplete="new-password" minLength={8} maxLength={500} required /></label>
              <fieldset className="webhook-events"><legend>Events</legend>{eventOptions.map(eventName => <label className="webhook-check" key={eventName}><input type="checkbox" checked={events.includes(eventName)} onChange={() => toggleEvent(eventName)} />{eventName}</label>)}</fieldset>
              <button className="primary-button" disabled={saving || !name.trim() || !url.trim() || !secret.trim() || events.length === 0}>{saving ? "Creating…" : "Create endpoint"}</button>
            </form>
          </section>
          <section className="section">
            <div className="detail-header"><div><h2>Configured endpoints</h2><p className="muted">{endpoints.length} endpoint{endpoints.length === 1 ? "" : "s"} in this workspace.</p></div></div>
            {endpoints.length === 0 ? <p className="muted">No webhook endpoints configured yet.</p> : endpoints.map(endpoint => {
              const selectedEvents = Array.isArray(endpoint.events) ? endpoint.events.map(String) : [];
              return <div className="webhook-endpoint-wrap" key={endpoint.id}>
                <div className="webhook-endpoint"><div className="webhook-endpoint-main"><strong>{endpoint.name}</strong><span className="muted webhook-url">{endpoint.url}</span><span className="small muted">{selectedEvents.join(", ") || "No events"} · Created {new Date(endpoint.createdAt).toLocaleDateString()}</span></div><div className="webhook-endpoint-actions"><span className="badge">{endpoint.status}</span><button className="secondary-button" type="button" onClick={() => void toggleEndpointStatus(endpoint)}>{endpoint.status === "ACTIVE" ? "Pause" : "Activate"}</button><button className="secondary-button" type="button" onClick={() => editingId === endpoint.id ? setEditingId("") : beginEdit(endpoint)}>{editingId === endpoint.id ? "Cancel edit" : "Edit"}</button><button className="secondary-button" type="button" onClick={() => void removeEndpoint(endpoint)}>Delete</button></div></div>
                {editingId === endpoint.id && <form className="segment-form webhook-edit-form" onSubmit={event => void updateEndpoint(event, endpoint)}>
                  <label>Name<input value={editName} onChange={e => setEditName(e.target.value)} maxLength={120} required /></label>
                  <label>HTTPS endpoint URL<input type="url" value={editUrl} onChange={e => setEditUrl(e.target.value)} required /></label>
                  <label>Replace signing secret (optional)<input value={editSecret} onChange={e => setEditSecret(e.target.value)} type="password" autoComplete="new-password" minLength={8} maxLength={500} placeholder="Leave blank to keep current secret" /></label>
                  <fieldset className="webhook-events"><legend>Events</legend>{eventOptions.map(eventName => <label className="webhook-check" key={eventName}><input type="checkbox" checked={editEvents.includes(eventName)} onChange={() => toggleEditEvent(eventName)} />{eventName}</label>)}</fieldset>
                  <button className="primary-button" disabled={updatingId === endpoint.id || !editName.trim() || !editUrl.trim() || editEvents.length === 0}>{updatingId === endpoint.id ? "Saving…" : "Save changes"}</button>
                </form>}
              </div>;
            })}
          </section>
        </div>
        <section className="section">
          <div className="detail-header"><div><h2>Delivery history</h2><p className="muted">{total} matching delivery{total === 1 ? "" : "ies"} · latest 50</p></div><select className="status-select" aria-label="Filter deliveries by status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="QUEUED">Queued</option><option value="DELIVERING">Delivering</option><option value="DELIVERED">Delivered</option><option value="FAILED">Failed</option></select></div>
          {deliveries.length === 0 ? <p className="muted">No deliveries match this filter yet. Deliveries appear when configured events occur.</p> : <div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Event</th><th>Status</th><th>Attempts</th><th>Created</th><th>Delivered</th><th>Last error</th><th>Action</th></tr></thead><tbody>{deliveries.map(delivery => <tr key={delivery.id}><td>{delivery.endpoint.name}</td><td><span title={delivery.eventId}>{delivery.eventType}</span></td><td><span className="badge">{delivery.status}</span></td><td>{delivery.attempts}</td><td>{new Date(delivery.createdAt).toLocaleString()}</td><td>{delivery.deliveredAt ? new Date(delivery.deliveredAt).toLocaleString() : "—"}</td><td className="webhook-error" title={delivery.lastError ?? ""}>{delivery.lastError ?? "—"}</td><td>{delivery.status === "FAILED" ? <button className="secondary-button" type="button" disabled={Boolean(retryingId)} onClick={() => void retryDelivery(delivery)}>{retryingId === delivery.id ? "Queueing…" : "Retry"}</button> : "—"}</td></tr>)}</tbody></table></div>}
        </section>
      </section>
    </main>
  );
}
