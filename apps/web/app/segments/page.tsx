"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Rule = { field: "orderCount" | "totalSpend" | "lastOrderDaysAgo" | "tag"; operator: "gte" | "lte" | "eq" | "neq" | "gt" | "lt"; value: string | number };
type Segment = { id: string; name: string; description?: string | null; rules: { match: "all" | "any"; rules: Rule[] }; customerCount: number };
type Member = { id: string; email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; orderCount: number; totalSpend: string; lastOrderAt: string | null; tags: string[] };
type MemberResponse = { items: Member[]; total: number; page: number; pageSize: number; totalPages: number };

const fieldLabels = { orderCount: "Orders", totalSpend: "Spend", lastOrderDaysAgo: "Days since last order", tag: "Tag" } as const;
const operators = ["gte", "lte", "eq", "neq", "gt", "lt"] as const;
const operatorLabels = { gte: ">=", lte: "<=", eq: "=", neq: "!=", gt: ">", lt: "<" } as const;
const emptyRule = (): Rule => ({ field: "orderCount", operator: "gte", value: 1 });

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<Member[]>([]);
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotalPages, setMemberTotalPages] = useState(1);
  const memberPageSize = 25;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<Rule[]>([emptyRule()]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => { try { setSegments(await api<Segment[]>("/crm/segments")); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load segments"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const create = async () => { if (!name.trim()) return; setSaving(true); try { await api("/crm/segments", { method: "POST", body: JSON.stringify({ name, description, rules: { match, rules } }) }); setName(""); setDescription(""); setRules([emptyRule()]); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create segment"); } finally { setSaving(false); } };
  const open = async (id: string, targetPage = 1) => { setSelectedId(id); try { const response = await api<MemberResponse>(`/crm/segments/${id}/customers?page=${targetPage}&pageSize=${memberPageSize}`); setSelected(response.items); setMemberPage(response.page); setMemberTotalPages(response.totalPages); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load segment members"); } };
  const remove = async (id: string) => { if (!window.confirm("Delete this segment?")) return; try { await api(`/crm/segments/${id}`, { method: "DELETE" }); if (selectedId === id) { setSelectedId(""); setSelected([]); setMemberPage(1); setMemberTotalPages(1); } await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete segment"); } };
  const updateRule = (index: number, patch: Partial<Rule>) => setRules(current => current.map((rule, i) => i === index ? { ...rule, ...patch, value: patch.field && patch.field === "tag" ? "" : patch.value ?? rule.value } : rule));

  return <main className="main workspace-page">
    <header className="header"><div><h1 className="title">Customer segments</h1><div className="muted">Build live audiences from customer behavior and CRM tags.</div></div><a className="back-link" href="/customers">Customers</a></header>
    {error && <p className="error">{error}</p>}
    <section className="section"><h2>Create segment</h2><div className="segment-form">
      <label>Name<input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="VIP customers" /></label>
      <label>Description<input value={description} onChange={e => setDescription(e.target.value)} maxLength={240} placeholder="Customers ready for retention campaigns" /></label>
      <div className="segment-rule-head"><strong>Rules</strong><select value={match} onChange={e => setMatch(e.target.value as "all" | "any")}><option value="all">Match all rules</option><option value="any">Match any rule</option></select></div>
      {rules.map((rule, index) => <div className="segment-rule" key={index}><select value={rule.field} onChange={e => updateRule(index, { field: e.target.value as Rule["field"], value: e.target.value === "tag" ? "" : 1 })}>{Object.entries(fieldLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={rule.operator} onChange={e => updateRule(index, { operator: e.target.value as Rule["operator"] })}>{operators.map(operator => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select><input type={rule.field === "tag" ? "text" : "number"} min="0" value={rule.value} onChange={e => updateRule(index, { value: rule.field === "tag" ? e.target.value : Number(e.target.value) })} placeholder={rule.field === "tag" ? "VIP" : "0"} /><button className="secondary-button" disabled={rules.length === 1} onClick={() => setRules(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}
      <div><button className="secondary-button" onClick={() => setRules(current => [...current, emptyRule()])} disabled={rules.length >= 10}>Add rule</button> <button className="primary-button" onClick={() => void create()} disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create segment"}</button></div>
    </div></section>
    <section className="section"><div className="detail-header"><div><h2>Saved segments</h2><p className="muted">Counts are evaluated from current customer and order data.</p></div></div>{loading ? <p className="muted">Loading segments...</p> : segments.length === 0 ? <p className="muted">No segments yet.</p> : segments.map(segment => <div className="segment-card" key={segment.id}><div onClick={() => void open(segment.id)} className="segment-main"><strong>{segment.name}</strong><span className="muted">{segment.customerCount} customers · {segment.rules.rules.length} rule{segment.rules.rules.length === 1 ? "" : "s"}</span><small className="muted">{segment.description || "No description"}</small></div><button className="secondary-button" onClick={() => void remove(segment.id)}>Delete</button></div>)}</section>
    {selectedId && <section className="section"><h2>Segment members</h2>{selected.length === 0 ? <p className="muted">No customers currently match this segment.</p> : <><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Spend</th><th>Last order</th><th>Tags</th></tr></thead><tbody>{selected.map(member => <tr key={member.id}><td><strong>{[member.firstName, member.lastName].filter(Boolean).join(" ") || "Unnamed customer"}</strong></td><td>{member.email || member.phone || "—"}</td><td>{member.orderCount}</td><td>PKR {member.totalSpend}</td><td>{member.lastOrderAt ? new Date(member.lastOrderAt).toLocaleDateString() : "—"}</td><td>{member.tags.join(", ") || "—"}</td></tr>)}</tbody></table></div>{memberTotalPages > 1 && <div className="detail-header"><span className="muted">Page {memberPage} of {memberTotalPages}</span><div className="tag-list"><button className="secondary-button" onClick={() => void open(selectedId, memberPage - 1)} disabled={memberPage === 1}>Previous</button><button className="secondary-button" onClick={() => void open(selectedId, memberPage + 1)} disabled={memberPage === memberTotalPages}>Next</button></div></div></>}</section>}
  </main>;
}
