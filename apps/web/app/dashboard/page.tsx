"use client";

import { useEffect, useState } from "react";
import { api, type Product, type Store } from "../../lib/api";

export default function DashboardPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { const [s, p] = await Promise.all([api<Store[]>("/stores"), api<Product[]>("/products")]); setStores(s); setProducts(p); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Unable to load workspace"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const createProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stores[0] || !name || !sku || !price) return;
    setMessage("");
    try { await api("/products", { method: "POST", body: JSON.stringify({ storeId: stores[0].id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), status: "ACTIVE", variant: { sku, price: Number(price), stock: 0 } }) }); setName(""); setSku(""); setPrice(""); await load(); setMessage("Product created"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not create product"); }
  };

  const logout = () => { localStorage.removeItem("commerceos_token"); window.location.href = "/login"; };

  if (loading) return <main className="main"><p>Loading workspace...</p></main>;
  return <main className="dashboard"><aside className="sidebar"><div className="brand">CommerceOS</div><nav className="nav"><span className="active">Overview</span><span>Orders</span><span>Products</span><span>Customers</span><span>Inventory</span><span>Analytics</span><span>Automations</span><span>Settings</span></nav><button className="logout" onClick={logout}>Log out</button></aside><section className="main"><header className="header"><div><h1 className="title">Commerce command center</h1><div className="muted">Your live workspace data.</div></div><div className="muted">{stores[0]?.name ?? "No store"}</div></header><div className="cards"><div className="card"><div className="muted">Stores</div><div className="metric">{stores.length}</div></div><div className="card"><div className="muted">Products</div><div className="metric">{products.length}</div></div><div className="card"><div className="muted">Orders</div><div className="metric">0</div></div><div className="card"><div className="muted">Revenue</div><div className="metric">PKR 0</div></div></div><div className="section"><h2>Add product</h2><form className="product-form" onSubmit={createProduct}><input placeholder="Product name" value={name} onChange={e => setName(e.target.value)} /><input placeholder="SKU" value={sku} onChange={e => setSku(e.target.value)} /><input placeholder="Price (PKR)" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /><button type="submit">Create product</button></form>{message && <p className="muted">{message}</p>}</div><div className="section"><h2>Products</h2>{products.length === 0 ? <p className="muted">No products yet. Create your first product above.</p> : products.map(p => <div className="product-row" key={p.id}><strong>{p.name}</strong><span className="muted">{p.variants[0]?.sku} · PKR {p.variants[0]?.price} · {p.status}</span></div>)}</div></section></main>;
}
