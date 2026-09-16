# CommerceOS database

Prisma models for the core multi-tenant commerce domain.

Core entities currently include tenants, users, stores, products, variants, customers, orders, and order items.

Tenant ownership is explicit on commerce aggregates so API services can enforce isolation consistently.
