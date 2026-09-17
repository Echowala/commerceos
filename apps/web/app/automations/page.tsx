"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Automation = { id: string; name: string; description?: string | null; trigger: string; status: string; actions: unknown[]; updatedAt: string; _count?: { executions: number } };
type Execution = { id: string; status: string; startedAt: string; finishedAt?: string | null; error?: string | null };

const triggers = ["ORDER_PLACED", "ORDER_STATUS_CHANGED", "CUSTOMER_CREATED", "INVENTORY_LOW"];
const actions = ["ADD_CUSTOMER_TAG", "CREATE_CUSTOMER_NOTE", "SEND_WEBHOOK"];

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([]);
  const [selected, setSelected] = useState<Automation | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState(triggers[0]);
  const [action, setAction] = useState(actions[0]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => { try { setItems(await api<Automation[]>("/automations")); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load automations"); } };
  useEffect(() => { void load(); }, []);
  const select = async (item: Automation) => { setSelected(item); try { setExecutions(await api<Execution[]>(`/automations/${item.id}/executions?limit=20`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load executions"); } };
  const create = async (event: React.FormEvent) => { event.preventDefault(); if (!name.trim()) return; setSaving(true); setError(""); try { const created = await api<Automation>("/automations", { method: "POST", body: JSON.stringify({ name: name.trim(), trigger, actions: [{ type: action, ...(action === "CREATE_CUSTOMER_NOTE" ? { note: "Automation triggered" } : {}) }] }) }); setName(""); await load(); await select(created); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create automation"); } finally { setSaving(false); } };
  const toggle = async (item: Automation) => { try { const updated = await api<Automation>(`/automations/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }) }); await load(); await select(updated); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update automation"); } };

  return <main className="dashboard"><aside className="sidebar"><div className="brand">CommerceOS</div><nav className="nav"><a href="/">Overview</a><a href="/orders">Orders</a><a href="/customers">Customers</a><a href="/segments">Segments</a><a href="/products">Products</a><span>Inventory</span><span>Analytics</span><a className="active" href="/automations">Automations</a><span>Settings</span></nav></aside><section className="main"><header className="header"><div><h1 className="title">Automations</h1><div className="muted">Turn commerce events into repeatable operational actions.</div></div></header>{error && <p className="error">{error}</p>}<div className="automation-layout"><section className="section"><div className="detail-header"><div><h2>Create automation</h2><p className="muted">Start with a trigger and one safe action.</p></div></div><form className="segment-form" onSubmit={create}><label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="VIP customer tag" maxLength={120}/></label><label>Trigger<select value={trigger} onChange={e => setTrigger(e.target.value)}>{triggers.map(t => <option key={t}>{t}</option>)}</select></label><label>Action<select value={action} onChange={e => setAction(e.target.value)}>{actions.map(t => <option key={t}>{t}</option>)}</select></label><button className="primary-button" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create automation"}</button></form></section><section className="section"><div className="detail-header"><div><h2>Workflows</h2><p className="muted">{items.length} configured automation{items.length === 1 ? "" : "s"}.</p></div></div>{items.length === 0 ? <p className="muted">No automations yet.</p> : items.map(item => <button className={`automation-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => void select(item)}><span><strong>{item.name}</strong><small className="muted">{item.trigger} · {item._count?.executions ?? 0} executions</small></span><span className="automation-actions"><b className="badge">{item.status}</b><button type="button" className="secondary-button" onClick={e => { e.stopPropagation(); void toggle(item); }}>{item.status === "ACTIVE" ? "Pause" : "Activate"}</button></span></button>)}</section></div>{selected && <section className="section"><div className="detail-header"><div><h2>{selected.name}</h2><p className="muted">Execution history</p></div><span className="badge">{selected.trigger}</span></div>{executions.length === 0 ? <p className="muted">No executions recorded yet.</p> : <div className="table-wrap"><table><thead><tr><th>Status</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead><tbody>{executions.map(ex => <tr key={ex.id}><td><span className="badge">{ex.status}</span></td><td>{new Date(ex.startedAt).toLocaleString()}</td><td>{ex.finishedAt ? new Date(ex.finishedAt).toLocaleString() : "—"}</td><td>{ex.error ?? "—"}</td></tr>)}</tbody></table></div>}</section>}</section></main>;
}
