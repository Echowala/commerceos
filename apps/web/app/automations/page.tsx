"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type Automation = { id: string; name: string; description?: string | null; trigger: string; status: string; actions: unknown[]; updatedAt: string; _count?: { executions: number } };
type Execution = { id: string; status: string; startedAt: string; finishedAt?: string | null; error?: string | null };
type Tag = { id: string; name: string; color?: string | null };
type ActionConfig = { type: string; tagId?: string; note?: string; url?: string };

const triggers = ["ORDER_PLACED", "ORDER_STATUS_CHANGED", "CUSTOMER_CREATED", "INVENTORY_LOW"];
const actions = ["ADD_CUSTOMER_TAG", "CREATE_CUSTOMER_NOTE", "SEND_WEBHOOK"];

const firstAction = (value: unknown): ActionConfig => {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return { type: actions[0] };
  const item = value[0] as Record<string, unknown>;
  return {
    type: typeof item.type === "string" && actions.includes(item.type) ? item.type : actions[0],
    tagId: typeof item.tagId === "string" ? item.tagId : "",
    note: typeof item.note === "string" ? item.note : "Automation triggered",
    url: typeof item.url === "string" ? item.url : "",
  };
};

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<Automation | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState(triggers[0]);
  const [action, setAction] = useState(actions[0]);
  const [tagId, setTagId] = useState("");
  const [note, setNote] = useState("Automation triggered");
  const [url, setUrl] = useState("");
  const [editAction, setEditAction] = useState<ActionConfig | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try { setItems(await api<Automation[]>("/automations")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load automations"); }
  };

  useEffect(() => { void load(); void api<Tag[]>("/crm/tags").then(setTags).catch(() => undefined); }, []);

  const select = async (item: Automation) => {
    setSelected(item);
    setEditAction(firstAction(item.actions));
    setEditing(false);
    try { setExecutions(await api<Execution[]>(`/automations/${item.id}/executions?limit=20`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load executions"); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError("");
    const config = action === "ADD_CUSTOMER_TAG" ? { type: action, tagId } : action === "CREATE_CUSTOMER_NOTE" ? { type: action, note } : { type: action, url };
    try {
      const created = await api<Automation>("/automations", { method: "POST", body: JSON.stringify({ name: name.trim(), trigger, actions: [config] }) });
      setName(""); await load(); await select(created);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create automation"); }
    finally { setSaving(false); }
  };

  const toggle = async (item: Automation) => {
    try {
      const updated = await api<Automation>(`/automations/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }) });
      await load(); await select(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update automation"); }
  };

  const saveEdit = async () => {
    if (!selected || !editAction) return;
    setSaving(true); setError("");
    try {
      const updated = await api<Automation>(`/automations/${selected.id}`, { method: "PATCH", body: JSON.stringify({ trigger: selected.trigger, actions: [editAction] }) });
      await load(); await select(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save automation"); }
    finally { setSaving(false); }
  };

  const editValid = useMemo(() => {
    if (!editAction) return false;
    if (editAction.type === "ADD_CUSTOMER_TAG") return Boolean(editAction.tagId);
    if (editAction.type === "CREATE_CUSTOMER_NOTE") return Boolean(editAction.note?.trim()) && editAction.note!.trim().length <= 2000;
    return /^https:\/\//i.test(editAction.url ?? "");
  }, [editAction]);

  return <main className="dashboard">
    <aside className="sidebar"><div className="brand">CommerceOS</div><nav className="nav"><a href="/">Overview</a><a href="/orders">Orders</a><a href="/customers">Customers</a><a href="/segments">Segments</a><a href="/products">Products</a><span>Inventory</span><span>Analytics</span><a className="active" href="/automations">Automations</a><span>Settings</span></nav></aside>
    <section className="main">
      <header className="header"><div><h1 className="title">Automations</h1><div className="muted">Turn commerce events into repeatable operational actions.</div></div></header>
      {error && <p className="error">{error}</p>}
      <div className="automation-layout">
        <section className="section"><h2>Create automation</h2><p className="muted">Configure a real trigger and action.</p><form className="segment-form" onSubmit={create}>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="VIP customer tag" maxLength={120}/></label>
          <label>Trigger<select value={trigger} onChange={e => setTrigger(e.target.value)}>{triggers.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Action<select value={action} onChange={e => setAction(e.target.value)}>{actions.map(t => <option key={t}>{t}</option>)}</select></label>
          {action === "ADD_CUSTOMER_TAG" && <label>Customer tag<select value={tagId} onChange={e => setTagId(e.target.value)} required><option value="">Select a tag</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
          {action === "CREATE_CUSTOMER_NOTE" && <label>Note<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3}/></label>}
          {action === "SEND_WEBHOOK" && <label>HTTPS webhook URL<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/webhook" type="url" required/></label>}
          <button className="primary-button" disabled={saving || !name.trim() || (action === "ADD_CUSTOMER_TAG" && !tagId) || (action === "CREATE_CUSTOMER_NOTE" && !note.trim()) || (action === "SEND_WEBHOOK" && !url.trim())}>{saving ? "Creating…" : "Create automation"}</button>
        </form></section>
        <section className="section"><div className="detail-header"><div><h2>Workflows</h2><p className="muted">{items.length} configured automation{items.length === 1 ? "" : "s"}.</p></div></div>
          {items.length === 0 ? <p className="muted">No automations yet.</p> : items.map(item => <div className={`automation-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id}>
            <button className="automation-main" onClick={() => void select(item)}><strong>{item.name}</strong><small className="muted">{item.trigger} · {item._count?.executions ?? 0} executions</small></button>
            <span className="automation-actions"><b className="badge">{item.status}</b><button type="button" className="secondary-button" onClick={() => void toggle(item)}>{item.status === "ACTIVE" ? "Pause" : "Activate"}</button></span>
          </div>)}
        </section>
      </div>
      {selected && <section className="section">
        <div className="detail-header"><div><h2>{selected.name}</h2><p className="muted">Workflow configuration and execution history</p></div><div className="automation-actions"><span className="badge">{selected.trigger}</span><button className="secondary-button" type="button" onClick={() => setEditing(value => !value)}>{editing ? "Close editor" : "Edit action"}</button></div></div>
        {editing && editAction && <div className="segment-form">
          <label>Action<select value={editAction.type} onChange={e => setEditAction({ type: e.target.value, tagId: "", note: "Automation triggered", url: "" })}>{actions.map(t => <option key={t}>{t}</option>)}</select></label>
          {editAction.type === "ADD_CUSTOMER_TAG" && <label>Customer tag<select value={editAction.tagId ?? ""} onChange={e => setEditAction({ ...editAction, tagId: e.target.value })}><option value="">Select a tag</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
          {editAction.type === "CREATE_CUSTOMER_NOTE" && <label>Note<textarea value={editAction.note ?? ""} onChange={e => setEditAction({ ...editAction, note: e.target.value })} maxLength={2000} rows={3}/></label>}
          {editAction.type === "SEND_WEBHOOK" && <label>HTTPS webhook URL<input value={editAction.url ?? ""} onChange={e => setEditAction({ ...editAction, url: e.target.value })} placeholder="https://example.com/webhook" type="url"/></label>}
          <button className="primary-button" type="button" disabled={saving || !editValid} onClick={() => void saveEdit()}>{saving ? "Saving…" : "Save action"}</button>
        </div>}
        <div className="detail-header"><div><h3>Execution history</h3></div></div>
        {executions.length === 0 ? <p className="muted">No executions recorded yet.</p> : <div className="table-wrap"><table><thead><tr><th>Status</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead><tbody>{executions.map(ex => <tr key={ex.id}><td><span className="badge">{ex.status}</span></td><td>{new Date(ex.startedAt).toLocaleString()}</td><td>{ex.finishedAt ? new Date(ex.finishedAt).toLocaleString() : "—"}</td><td>{ex.error ?? "—"}</td></tr>)}</tbody></table></div>}
      </section>}
    </section>
  </main>;
}
