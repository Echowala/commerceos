"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type OrderResponse = { items: Order[]; total: number; page: number; pageSize: number; totalPages: number };
type Order = {
  id: string; orderNumber: string; status: string; paymentStatus: string;
  total: string | number; currency: string; createdAt: string;
  customer?: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null } | null;
  store?: { name: string };
  items: { id: string; name: string; quantity: number; unitPrice: string | number; total: string | number }[];
};

const statuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadOrders = async () => {
    try {
      setError("");
      const result = await api<OrderResponse>(`/orders?page=${page}&pageSize=25`);
      setOrders(result.items);
      setTotalPages(result.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadOrders(); }, [page]);

  const updateStatus = async (orderId: string, nextStatus: string) => {
    setUpdating(orderId);
    setError("");
    try {
      const result = await api<{ status: string }>(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setOrders(current => current.map(order => order.id === orderId ? { ...order, status: result.status } : order));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update order");
    } finally {
      setUpdating("");
    }
  };

  return (
    <main className="main workspace-page">
      <header className="header">
        <div><h1 className="title">Orders</h1><div className="muted">Manage orders across your commerce workspace.</div></div>
        <a className="back-link" href="/">Dashboard</a>
      </header>
      <section className="section">
        {loading ? <p className="muted">Loading orders...</p> : error && orders.length === 0 ? <p className="error">{error}</p> : orders.length === 0 ? <p className="muted">No orders yet. Orders created through the API will appear here.</p> : (
          <>
            {error ? <p className="error">{error}</p> : null}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th><th>Date</th></tr></thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id}>
                      <td><a className="back-link" href={`/orders/${o.id}`}><strong>#{o.orderNumber}</strong></a><div className="muted small">{o.items.length} item{o.items.length === 1 ? "" : "s"}</div></td>
                      <td>{o.customer ? [o.customer.firstName, o.customer.lastName].filter(Boolean).join(" ") || o.customer.email || "Customer" : "Guest"}</td>
                      <td><select className="status-select" aria-label={`Status for order ${o.orderNumber}`} value={o.status} disabled={updating === o.id} onChange={e => void updateStatus(o.id, e.target.value)}>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select>{updating === o.id ? <div className="muted small">Saving...</div> : null}</td>
                      <td>{o.paymentStatus}</td><td>{o.currency} {o.total}</td><td>{new Date(o.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="detail-header"><button className="back-link" type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span className="muted">Page {page} of {totalPages}</span><button className="back-link" type="button" disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next</button></div>
          </>
        )}
      </section>
    </main>
  );
}
