export type ID = string;
export interface Tenant { id: ID; name: string; slug: string }
export interface Store { id: ID; tenantId: ID; name: string; slug: string }
export interface Product { id: ID; storeId: ID; name: string; slug: string; status: "draft" | "active" | "archived" }
export interface Customer { id: ID; storeId: ID; email?: string; phone?: string; name?: string }
export interface Order { id: ID; storeId: ID; customerId: ID; status: "pending" | "paid" | "fulfilled" | "cancelled"; totalMinor: number; currency: string }
