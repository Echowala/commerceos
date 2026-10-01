"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, clearToken } from "../../lib/api";

type Store = { id: string; name: string; slug: string; currency: string; createdAt: string };
type Me = { tenant: { slug: string } };

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [currency, setCurrency] = useState("PKR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [storeData, me] = await Promise.all([api<Store[]>("/stores"), api<Me>("/me")]);
      setStores(storeData);
      setTenantSlug(me.tenant.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load stores");
    }
  };

  useEffect(() => { void load(); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const store = await api<Store>("/stores", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined, currency: currency.trim().toUpperCase() }),
      });
      setStores(current => [store, ...current]);
      setName("");
      setSlug("");
      setCurrency("PKR");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create store");
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    clearToken();
    window.location.href = "/login";
  };

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
            <h1 className="title">Stores</h1>
            <div className="muted">Create and manage the storefronts connected to this CommerceOS workspace.</div>
          </div>
          <a className="back-link" href="/">Dashboard</a>
        </header>

        {error && <p className="error">{error}</p>}

        <section className="section">
          <div className="detail-header">
            <div>
              <h2>Create store</h2>
              <p className="muted">A store is the commerce surface where products, checkout and orders live.</p>
            </div>
          </div>
          <form onSubmit={submit} className="tracking-form">
            <label>Store name<input value={name} onChange={e => setName(e.target.value)} placeholder="My Store" required /></label>
            <label>Store slug<input value={slug} onChange={e => setSlug(e.target.value)} placeholder="my-store" /></label>
            <label>Currency<input value={currency} onChange={e => setCurrency(e.target.value)} maxLength={3} required /></label>
            <button className="checkout-button" disabled={saving}>{saving ? "Creating…" : "Create store"}</button>
          </form>
        </section>

        <section className="section">
          <div className="detail-header">
            <div>
              <h2>Your stores</h2>
              <p className="muted">{stores.length} store{stores.length === 1 ? "" : "s"} in this workspace.</p>
            </div>
          </div>
          {stores.length === 0 ? (
            <p className="muted">No stores yet. Create your first store above.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Store</th><th>Slug</th><th>Currency</th><th>Settings</th><th>Storefront</th></tr></thead>
                <tbody>
                  {stores.map(store => (
                    <tr key={store.id}>
                      <td><strong>{store.name}</strong></td>
                      <td>/{store.slug}</td>
                      <td>{store.currency}</td>
                      <td><a className="back-link" href={`/stores/${store.id}`}>Manage</a></td>
                      <td>{tenantSlug ? <a className="back-link" href={`/store/${tenantSlug}/${store.slug}`}>Open</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
