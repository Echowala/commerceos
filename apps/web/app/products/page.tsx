"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, clearToken } from "../../lib/api";

type Store = { id: string; name: string; currency: string };
type Product = { id: string; name: string; slug: string; status: string; variants: { sku: string; price: string | number; stock: number }[] };

export default function ProductsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [status, setStatus] = useState("DRAFT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [storeData, productData] = await Promise.all([api<Store[]>("/stores"), api<Product[]>("/products")]);
      setStores(storeData);
      setProducts(productData);
      if (!storeId && storeData[0]) setStoreId(storeData[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load products");
    }
  };

  useEffect(() => { void load(); }, []);

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const product = await api<Product>("/products", {
        method: "POST",
        body: JSON.stringify({
          storeId,
          name: name.trim(),
          variant: { sku: sku.trim(), price: Number(price), stock: Number(stock) },
          status,
        }),
      });
      setProducts(current => [product, ...current]);
      setName(""); setSku(""); setPrice(""); setStock("0"); setStatus("DRAFT");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create product");
    } finally {
      setSaving(false);
    }
  };

  const logout = () => { clearToken(); window.location.href = "/login"; };

  return <main className="dashboard">
    <aside className="sidebar">
      <div className="brand">CommerceOS</div>
      <nav className="nav">
        <a href="/">Overview</a><a href="/orders">Orders</a><a href="/customers">Customers</a><a className="active" href="/products">Products</a>
        <span>Inventory</span><span>Analytics</span><span>Automations</span><span>Settings</span>
      </nav>
      <button className="logout" onClick={logout}>Log out</button>
    </aside>
    <section className="main">
      <header className="header"><div><h1 className="title">Products</h1><div className="muted">Manage your catalog, pricing and available stock.</div></div><a className="back-link" href="/">Dashboard</a></header>
      {error && <p className="error">{error}</p>}
      <section className="section">
        <div className="detail-header"><div><h2>Add product</h2><p className="muted">Create the first sellable variant for a product.</p></div></div>
        {stores.length === 0 ? <p className="muted">Create a store before adding products.</p> : <form onSubmit={createProduct} className="tracking-form">
          <label>Store<select className="status-select" value={storeId} onChange={e => setStoreId(e.target.value)}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <label>Product name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Classic T-Shirt" required /></label>
          <label>SKU<input value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. TS-BLK-M" required /></label>
          <label>Price<input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" required /></label>
          <label>Stock<input type="number" min="0" step="1" value={stock} onChange={e => setStock(e.target.value)} required /></label>
          <label>Status<select className="status-select" value={status} onChange={e => setStatus(e.target.value)}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></label>
          <button className="checkout-button" disabled={saving || !storeId}>{saving ? "Creating…" : "Create product"}</button>
        </form>}
      </section>
      <section className="section"><div className="detail-header"><div><h2>Catalog</h2><p className="muted">{products.length} product{products.length === 1 ? "" : "s"} in this workspace.</p></div></div>
        {products.length === 0 ? <p className="muted">No products yet.</p> : <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{products.map(product => { const variant = product.variants[0]; return <tr key={product.id}><td><strong>{product.name}</strong><div className="muted small">/{product.slug}</div></td><td>{variant?.sku ?? "—"}</td><td>{variant?.price ?? "0"}</td><td>{variant?.stock ?? 0}</td><td><span className="badge">{product.status}</span></td></tr>; })}</tbody></table></div>}
      </section>
    </section>
  </main>;
}
