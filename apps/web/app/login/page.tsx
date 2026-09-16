"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveToken } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter(); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [tenantId,setTenantId]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setLoading(true); setError(""); try { const result=await api<{token:string}>("/auth/dev-login",{method:"POST",body:JSON.stringify({email,password,tenantId})}); saveToken(result.token); router.push("/"); } catch(e) { setError(e instanceof Error?e.message:"Unable to sign in"); } finally { setLoading(false); } }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><div className="brand">CommerceOS</div><h1>Welcome back</h1><p className="muted">Sign in to your commerce workspace.</p><label>Workspace ID<input value={tenantId} onChange={e=>setTenantId(e.target.value)} required /></label><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>{error&&<div className="error">{error}</div>}<button disabled={loading}>{loading?"Signing in…":"Sign in"}</button><a href="/signup">Create a new workspace</a></form></main>;
}
