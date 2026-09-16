"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveToken } from "../../lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try { const result = await api<{ token: string }>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password, tenantName }) }); saveToken(result.token); router.push("/"); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to create workspace"); }
    finally { setLoading(false); }
  }

  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><div className="brand">CommerceOS</div><h1>Create your workspace</h1><p className="muted">Start running your commerce business from one command center.</p><label>Your name<input value={name} onChange={e => setName(e.target.value)} required /></label><label>Business name<input value={tenantName} onChange={e => setTenantName(e.target.value)} required /></label><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <div className="error">{error}</div>}<button disabled={loading}>{loading ? "Creating…" : "Create workspace"}</button><a href="/login">Already have an account? Sign in</a></form></main>;
}
