"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type Store = { id: string; name: string; slug: string; currency: string };
type Product = { id: string; name: string; slug: string; description?: string | null; status: string; variants: { id: string; sku: string; price: string | number; stock: number }[] };
type CartItem = { product: Product; variantId: string; quantity: number };

type OrderResponse = { orderNumber: string; total: string | number; currency: string };

export default function StorefrontPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void (async () => { try { const stores = await api<Store[]>("/stores"); const active = stores[0] ?? null; setStore(active); if (active) setProducts((await api<Product[]>(`/products?storeId=${encodeURIComponent(active.id)}`)).filter(p => p.status === "ACTIVE")); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to load storefront"); } })(); }, []);

  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.product.variants.find(v => v.id === item.variantId)?.price ?? 0) * item.quantity, 0), [cart]);
  const add = (product: Product) => { const variant = product.variants[0]; if (!variant || variant.stock <= 0) return; setCart(current => { const found = current.find(i => i.variantId === variant.id); return found ? current.map(i => i.variantId === variant.id ? { ...i, quantity: Math.min(i.quantity + 1, variant.stock) } : i) : [...current, { product, variantId: variant.id, quantity: 1 }]; }); setMessage(""); };
  const checkout = async (event: React.FormEvent) => { event.preventDefault(); if (!store || !email || cart.length === 0) return; setBusy(true); setMessage(""); try { const order = await api<OrderResponse>("/orders", { method: "POST", body: JSON.stringify({ storeId: store.id, customer: { email, name, phone }, items: cart.map(i => ({ variantId: i.variantId, quantity: i.quantity })) }) }); setCart([]); setCheckoutOpen(false); setMessage(`Order #${order.orderNumber} created successfully.`); setEmail(""); setName(""); setPhone(""); } catch (e) { setMessage(e instanceof Error ? e.message : "Checkout failed"); } finally { setBusy(false); } };

  return <main className="storefront"><header className="store-header"><div><div className="store-brand">{store?.name ?? "CommerceOS Store"}</div><div className="muted">Shop online</div></div><button className="cart-button" onClick={() => setCheckoutOpen(true)} disabled={cart.length === 0}>Cart ({cart.reduce((n, i) => n + i.quantity, 0)}) · PKR {total.toFixed(2)}</button></header><section className="store-hero"><span className="eyebrow">MODERN COMMERCE</span><h1>Products made for your customers.</h1><p>Browse the catalog and place an order through the CommerceOS checkout.</p></section><section className="product-grid">{products.length === 0 ? <div className="empty-state">No active products are available yet.</div> : products.map(product => { const variant = product.variants[0]; return <article className="product-card" key={product.id}><div className="product-art">{product.name.slice(0, 1).toUpperCase()}</div><div className="product-info"><div><h2>{product.name}</h2><p>{product.description || "Quality product from our store."}</p></div><div className="product-buy"><strong>PKR {variant?.price ?? "0"}</strong><button onClick={() => add(product)} disabled={!variant || variant.stock <= 0}>{variant?.stock ? "Add to cart" : "Out of stock"}</button></div></div></article>; })}</section>{message && <div className="store-message">{message}</div>}{checkoutOpen && <div className="modal-backdrop"><form className="checkout-card" onSubmit={checkout}><div className="detail-header"><div><h2>Checkout</h2><div className="muted">{cart.reduce((n, i) => n + i.quantity, 0)} item(s) · PKR {total.toFixed(2)}</div></div><button type="button" className="secondary-button" onClick={() => setCheckoutOpen(false)}>Close</button></div><label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></label><label>Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Phone<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="03xx xxxxxxx" /></label><div className="checkout-items">{cart.map(item => <div className="product-row" key={item.variantId}><span>{item.product.name} × {item.quantity}</span><strong>PKR {(Number(item.product.variants.find(v => v.id === item.variantId)?.price ?? 0) * item.quantity).toFixed(2)}</strong></div>)}</div><button className="checkout-button" disabled={busy}>{busy ? "Placing order..." : "Place order"}</button></form></div>}</main>;
}
