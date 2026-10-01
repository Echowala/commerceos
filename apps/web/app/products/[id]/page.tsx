"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Variant = { id: string; sku: string; price: string | number; stock: number };
type Product = { id: string; name: string; slug: string; description?: string | null; status: string; variants: Variant[]; store?: { id: string; name: string; currency: string } };

const statuses = ["DRAFT", "ACTIVE", "ARCHIVED"];

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const result = await api<Product>(`/products/${params.id}`);
      setProduct(result);
      setName(result.name);
      setSlug(result.slug);
      setDescription(result.description ?? "");
      setStatus(result.status);
      const variant = result.variants[0];
      setSku(variant?.sku ?? "");
      setPrice(variant ? String(variant.price) : "");
      setStock(variant ? String(variant.stock) : "0");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load product");
    }
  };

  useEffect(() => { void load(); }, [params.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!product) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const requestedStock = Number(stock);
      const requestedPrice = Number(price);
      if (!Number.isInteger(requestedStock) || requestedStock < 0) throw new Error("Stock must be a non-negative integer");
      if (!Number.isFinite(requestedPrice) || requestedPrice < 0) throw new Error("Price must be a non-negative number");
      const updated = await api<Product>(`/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
          status,
          variant: { sku: sku.trim(), price: requestedPrice, stock: requestedStock },
        }),
      });
      setProduct(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save product");
    } finally {
      setSaving(false);
    }
  };

  if (!product) return <main className="main workspace-page"><header className="header"><div><a className="back-link" href="/products">← Products</a><h1 className="title">Product</h1></div></header>{error ? <p className="error">{error}</p> : <p className="muted">Loading product...</p>}</main>;

  const variant = product.variants[0];

  return (
    <main className="main workspace-page">
      <header className="header">
        <div>
          <a className="back-link" href="/products">← Products</a>
          <h1 className="title">{product.name}</h1>
          <div className="muted">{product.store?.name ?? "Store"} · /{product.slug}</div>
        </div>
        <span className="badge">{product.status}</span>
      </header>

      {error && <p className="error">{error}</p>}
      {saved && <p className="muted">Product saved successfully.</p>}

      <section className="section">
        <div className="detail-header"><div><h2>Catalog details</h2><p className="muted">Update product identity, publishing state, pricing and stock.</p></div></div>
        <form onSubmit={submit} className="tracking-form">
          <label>Product name<input value={name} onChange={e => setName(e.target.value)} maxLength={200} required /></label>
          <label>Slug<input value={slug} onChange={e => setSlug(e.target.value)} maxLength={200} required /></label>
          <label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} rows={5} /></label>
          <label>Status<select className="status-select" value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>SKU<input value={sku} onChange={e => setSku(e.target.value)} maxLength={120} required /></label>
          <label>Price<input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required /></label>
          <label>Stock<input type="number" min="0" step="1" value={stock} onChange={e => setStock(e.target.value)} required /></label>
          <button className="checkout-button" disabled={saving}>{saving ? "Saving…" : "Save product"}</button>
        </form>
      </section>

      <section className="section">
        <div className="detail-header"><div><h2>Variants</h2><p className="muted">Current variant inventory and pricing.</p></div></div>
        {product.variants.map(item => (
          <div className="product-row" key={item.id}>
            <div><strong>{item.sku}</strong><div className="muted">Variant ID {item.id}</div></div>
            <span>{product.store?.currency ?? "PKR"} {item.price} · {item.stock} in stock</span>
          </div>
        ))}
        {product.variants.length === 0 && <p className="muted">No variants configured.</p>}
      </section>
    </main>
  );
}
