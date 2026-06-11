# BORROW · Studio

Internal operations dashboard for **BORROW**, a curated dress rental and consignment boutique.

**Live:** https://borrow-zeta.vercel.app (password-protected)

## Stack

- Next.js 16 (App Router) · Tailwind CSS v4
- Neon Postgres (`borrow-db`) for all data
- Vercel Blob (`borrow-store`) for item photos
- Deployed on Vercel (App Studio team) — pushes to `main` auto-deploy

## Features

- **Inventory** — add/edit/delete pieces with photo upload, brand, size, color,
  tier (Standard $45 / Mid $65 / Premium $85), pricing, ownership (owned vs consignment),
  consignor, event types, condition notes; auto-generated IDs (`BRW-0001`);
  status tracking (Available / Reserved / Rented Out / Being Cleaned / Retired);
  search + filters by tier, size, status, event, brand.
- Calendar, Returns, Consignors, Finances, Customers — coming next.

## Access

The whole app sits behind a password gate (`APP_PASSWORD` env var on Vercel).
To change the password: update the env var and redeploy.
