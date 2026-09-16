# CommerceOS

AI-native operating system for modern commerce.

## Current foundation

- `apps/web` — merchant UI/storefront foundation
- `apps/api` — backend API foundation
- `packages/types` — shared commerce domain types
- PostgreSQL + Redis development services
- pnpm workspace and shared TypeScript configuration

## Architecture direction

CommerceOS starts as a modular monolith with tenant isolation, clear domain boundaries, API contracts, auditability, and permission-controlled AI actions.

## First vertical slice

```text
Create Account -> Create Store -> Dashboard -> Add Product
-> Storefront -> Customer Order -> Customer 360 / CRM
```
