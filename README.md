# CommerceOS

AI-native operating system for modern commerce.

## Vision

CommerceOS brings storefront, CRM, inventory, automation, analytics, and AI into one multi-tenant platform.

## Foundation

This repository is initialized as a modular monolith with a TypeScript-first stack. The architecture is designed to support:

- Merchant dashboard and storefront
- Multi-tenant organizations and stores
- Products, variants, inventory, customers, and orders
- Customer 360 CRM
- AI-assisted commerce workflows
- Omnichannel integrations

## Initial architecture

```text
apps/
  web/        Merchant dashboard + storefront
  api/        Backend API
packages/
  database/   PostgreSQL + Prisma
  types/      Shared domain types
```

The project will evolve incrementally from a working vertical slice rather than prematurely splitting into microservices.

## Development principles

1. Tenant isolation from day one.
2. Secure-by-default authentication, authorization, webhooks, and audit logging.
3. Domain-driven modules inside a modular monolith.
4. API-first contracts and shared types.
5. AI actions must be observable and permission-controlled.
6. Ship a thin end-to-end commerce flow before expanding the platform.
