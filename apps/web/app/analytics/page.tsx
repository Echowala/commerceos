"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Analytics = {
  days: number;
  summary: { orders: number; customers: number; revenue: string; averageOrderValue: string };
  orderStatuses: { status: string; count: number }[];
  topProducts: { productId: string; name: string; units: number; revenue: string }[];
  daily: { date: string; orders: number; revenue: string }[];
};

export default function AnalyticsPage() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");

  const load = async (range = days) => {
    try {
      setError("");
      setData(await api<Analytics>(`/analytics?days=${range}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load analytics");
    }
  };

  useEffect(() => { void load(); }, []);

  if (!data) return <main className="dashboard-shell"><section className="dashboard-main"><div className="page-card">{error ? <p className="form-error">{error}</p> : "Loading analytics…"}</div></section></main>;

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <div className="brand">CommerceOS</div>
      <nav>
        <a href="/">Overview</a><a href="/orders">Orders</a><a href="/customers">Customers</a>
        <a href="/products">Products</a><a href="/inventory">Inventory</a>
        <a className="active" href="/analytics">Analytics</a><a href="/automations">Automations</a>
      </nav>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-header">
        <div><p className="eyebrow">Intelligence</p><h1>Commerce Analytics</h1><p>Operational performance from real order, customer and product data.</p></div>
        <select value={days} onChange={e => { setDays(e.target.value); void load(e.target.value); }}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
        </select>
      </header>
      {error && <div className="form-error">{error}</div>}
      <div className="stats-grid">
        <div className="stat-card"><span>Paid revenue</span><strong>PKR {data.summary.revenue}</strong></div>
        <div className="stat-card"><span>Orders</span><strong>{data.summary.orders}</strong></div>
        <div className="stat-card"><span>New customers</span><strong>{data.summary.customers}</strong></div>
        <div className="stat-card"><span>Average order</span><strong>PKR {data.summary.averageOrderValue}</strong></div>
      </div>
      <div className="inventory-grid">
        <section className="page-card">
          <div className="section-heading"><div><h2>Order status</h2><p>Orders created in the selected period.</p></div></div>
          <div className="movement-list">{data.orderStatuses.map(item => <div className="movement-row" key={item.status}><strong>{item.status}</strong><span>{item.count}</span></div>)}</div>
        </section>
        <section className="page-card">
          <div className="section-heading"><div><h2>Top products</h2><p>By recorded order-item revenue.</p></div></div>
          <div className="movement-list">{data.topProducts.map(item => <div className="movement-row" key={item.productId}><div><strong>{item.name}</strong><small>{item.units} units</small></div><span>PKR {item.revenue}</span></div>)}{!data.topProducts.length && <p>No product sales in this period.</p>}</div>
        </section>
      </div>
      <section className="page-card">
        <div className="section-heading"><div><h2>Daily performance</h2><p>Paid revenue and order volume by day.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Orders</th><th>Paid revenue</th></tr></thead><tbody>
          {data.daily.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.orders}</td><td>PKR {day.revenue}</td></tr>)}
          {!data.daily.length && <tr><td colSpan={3}>No orders in this period.</td></tr>}
        </tbody></table></div>
      </section>
    </section>
  </main>;
}
