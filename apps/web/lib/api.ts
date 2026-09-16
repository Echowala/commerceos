const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("commerceos_token") : null;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "request_failed");
  return data as T;
}

export type Store = { id: string; name: string; slug: string; currency: string };
export type Product = { id: string; name: string; slug: string; status: string; variants: { id: string; sku: string; price: string | number; stock: number }[] };
