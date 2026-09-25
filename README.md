# Jefram Stores — WhatsApp Bot + Store Platform

A complete store platform with a WhatsApp ordering bot, client-facing website, and admin panel backed by Supabase.

## Setup

1. Create a Supabase project at https://supabase.com and run the schema from `schema.sql`.
2. Copy `.env.example` to `.env` and fill in your credentials.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```

## Environment Variables

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_KEY` — your Supabase service role key
- `WHATSAPP_BOT_TOKEN` — WhatsApp Business API token (or use whatsapp-web.js session)
- `ADMIN_PHONE_NUMBER` — admin WhatsApp number for order notifications (e.g. `256771234567`)
- `PORT` — server port (default: 3000)

## Project Structure

- `server.js` — Express API backend
- `client/` — Customer storefront (index.html, styles.css, app.js)
- `admin/` — Admin panel for products/orders/payments (index.html, styles.css, app.js)
- `bot/` — WhatsApp bot for order placement (index.js)
- `schema.sql` — Database schema
- `.env` — Environment configuration

## Features

- Browse products on the client website
- Add items to cart and checkout with online or delivery payment
- Admin can add/edit/delete products
- Admin can view orders, confirm or reject payments
- WhatsApp bot for placing orders via chat
- Payment flow: under 100,000 UGX → full online; 100,000+ → 50% online, 50% on delivery

## Running with Docker

If using Supabase locally with Docker:

```bash
docker-compose up -d
npm start
```