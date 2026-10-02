"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, clearToken } from "../../../lib/api";

type Store = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  createdAt: string;
  _count?: { products: number; orders: number };
};
type Me = { tenant: { slug: string } };

export default function StoreSettingsPage() {
  const params = useParams<{ storeId: string }>();
  const storeId = params.storeId;
  const [store, setStore] = useState<Store | null>(null);
  const [tenantSlug, setTenantSlug] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [currency, setCurrency] = useState("PKR");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [data, me] = await Promise.all([
        api<Store>(`/stores/${storeId}`),
        api<Me>("/me"),
      ]);
      setStore(data);
      setTenantSlug(me.tenant.slug);
      setName(data.name);
      setSlug(data.slug);
      setCurrency(data.currency);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load store");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (storeId) void load();
  }, [storeId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const updated = await api<Store>(`/stores/${storeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          currency: currency.trim().toUpperCase(),
        }),
      });
      setStore(updated);
      setName(updated.name);
      setSlug(updated.slug);
      setCurrency(updated.currency);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save store");
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    clearToken();
    window.location.href = "/login";
  };

  const storefrontHref = store && tenantSlug ? `/store/${tenantSlug}/${store.slug}` : "";

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="brand">CommerceOS</div>
        <nav className="nav">
          <a href="/">Overview</a>
          <a href="/stores" className="active">Stores</a>
          <a href="/orders">Orders</a>
          <a href="/customers">Customers</a>
          <a href="/segments">Segments</a>
          <a href="/products">Products</a>
          <a href="/inventory">Inventory</a>
          <a href="/audit-logs">Audit logs</a>
          <a href="/automations">Automations</a>
        </nav>
        <button className="logout" onClick={logout}>Log out</button>
      </aside>

      <section className="main">
        <header className="header">
          <div>
            <h1 className="title">Store settings</h1>
            <div className="muted">Manage the core configuration for this storefront.</div>
          </div>
          <a className="back-link" href="/stores">Back to stores</a>
        </header>

        {error && <p className="error">{error}</p>}

        {loading ? (
          <section className="section"><p className="muted">Loading store…</p></section>
        ) : !store ? (
          <section className="section"><p className="muted">Store not found.</p></section>
        ) : (
          <>
            <section className="section">
              <div className="detail-header">
                <div>
                  <h2>General</h2>
                  <p className="muted">These values are used across your CommerceOS store and storefront.</p>
                </div>
                {saved && <span className="badge">Saved</span>}
              </div>

              <form onSubmit={submit} className="detail-grid">
                <label>
                  Store name
                  <input value={name} onChange={e => setName(e.target.value)} required />
                </label>
                <label>
                  Store slug
                  <input value={slug} onChange={e => setSlug(e.target.value)} required />
                </label>
                <label>
                  Currency
                  <input value={currency} onChange={e => setCurrency(e.target.value)} maxLength={3} required />
                </label>
                <div>
                  <div className="muted small">Store ID</div>
                  <div style={{ marginTop: 7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{store.id}</div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
            </section>

            <section className="section">
              <div className="detail-header">
                <div>
                  <h2>Storefront</h2>
                  <p className="muted">Open the actual customer-facing storefront for this store.</p>
                </div>
                {storefrontHref ? <a className="secondary-button" href={storefrontHref}>Open storefront</a> : <span className="muted">Preparing preview…</span>}
              </div>
              <div className="cards compact">
                <div className="card">
                  <div className="muted">Products</div>
                  <div className="metric">{store._count?.products ?? 0}</div>
                </div>
                <div className="card">
                  <div className="muted">Orders</div>
                  <div className="metric">{store._count?.orders ?? 0}</div>
                </div>
              </div>
              <p className="muted small">Public storefront routing is currently tenant/store based; custom domains can be added as the domain layer expands.</p>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
