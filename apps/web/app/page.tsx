const stats = [
  ["Revenue", "PKR 0", "Today"],
  ["Orders", "0", "Today"],
  ["Customers", "0", "Total"],
  ["Products", "0", "Active"],
];

export default function Dashboard() {
  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="brand">CommerceOS</div>
        <nav className="nav">
          <span className="active">Overview</span><span>Orders</span><span>Products</span><span>Customers</span><span>Inventory</span><span>Analytics</span><span>Automations</span><span>Settings</span>
        </nav>
      </aside>
      <section className="main">
        <header className="header"><div><h1 className="title">Good morning</h1><div className="muted">Your commerce command center.</div></div><div className="muted">Demo workspace</div></header>
        <div className="cards">{stats.map(([label, value, hint]) => <div className="card" key={label}><div className="muted">{label}</div><div className="metric">{value}</div><small className="muted">{hint}</small></div>)}</div>
        <div className="section"><h2>Commerce overview</h2><p className="muted">Connect your store to start seeing real orders, customers, products and AI-powered insights here.</p></div>
      </section>
    </main>
  );
}
