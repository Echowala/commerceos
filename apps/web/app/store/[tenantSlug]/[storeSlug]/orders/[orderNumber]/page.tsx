"use client";

import { FormEvent, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../../lib/api";

type Order = { orderNumber: string; status: string; paymentStatus: string; paymentMethod: string; subtotal: string; total: string; currency: string; shippingName?: string | null; shippingAddress?: string | null; createdAt: string; items: { name: string; quantity: number; unitPrice: string; total: string }[] };

const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export default function OrderTrackingPage() {
  const params = useParams<{ tenantSlug: string; storeSlug: string; orderNumber: string }>();
  const tenantSlug = decodeURIComponent(params.tenantSlug ?? ""); const storeSlug = decodeURIComponent(params.storeSlug ?? ""); const orderNumber = decodeURIComponent(params.orderNumber ?? "");
  const [email, setEmail] = useState(""); const [order, setOrder] = useState<Order | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const track = async (event: FormEvent) => { event.preventDefault(); if (!email) return; setBusy(true); setMessage(""); try { setOrder(await api<Order>(`/public/stores/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderNumber)}?email=${encodeURIComponent(email)}`)); } catch (e) { setOrder(null); setMessage(e instanceof Error && e.message === "order_not_found" ? "We could not find an order matching those details." : e instanceof Error ? e.message : "Unable to load order"); } finally { setBusy(false); } };
  return <main className="confirmation-page"><div className="confirmation-card"><span className="eyebrow">ORDER TRACKING</span><h1>Track order #{orderNumber}</h1>{!order ? <><p className="muted">Enter the email used at checkout to securely view this order.</p><form className="tracking-form" onSubmit={track}><label>Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><button className="checkout-button" disabled={busy}>{busy ? "Checking..." : "View order"}</button></form>{message && <div className="store-message">{message}</div>}</> : <><div className="order-status"><span>Status</span><strong>{label(order.status)}</strong></div><div className="confirmation-total"><span>Total</span><strong>{order.currency} {Number(order.total).toFixed(2)}</strong></div><div className="checkout-items">{order.items.map((item, index) => <div className="product-row" key={`${item.name}-${index}`}><span>{item.name} × {item.quantity}</span><strong>{order.currency} {Number(item.total).toFixed(2)}</strong></div>)}</div><div className="cod-note"><strong>{label(order.paymentMethod)}</strong><span>Payment status: {label(order.paymentStatus)}</span></div><div className="muted small">Placed {new Date(order.createdAt).toLocaleString()}</div></>}</div></main>;
}
