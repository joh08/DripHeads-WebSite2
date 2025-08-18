# DripHeads — Cloudflare + Stripe Tax (Verified)
Contents:
- `dripheads_site/` — static site (HTML/CSS/JS)
- `cloudflare_worker/` — Worker for multi-item Stripe Checkout with Stripe Tax, shipping, idempotency, verified success

## Setup
1) Stripe: create Products & Prices; (optional) Shipping Rates; enable Stripe Tax & email receipts.
2) Cloudflare Worker
```
cd cloudflare_worker
npm i
npx wrangler login
npx wrangler secret put STRIPE_SECRET_KEY
echo '{"neon-nights-001":"price_xxx","galaxy-drip-002":"price_yyy","aqua-bolt-003":"price_zzz","electric-rain-004":"price_www"}' | npx wrangler secret put PRICE_MAP_JSON
# Optional vars in wrangler.toml [vars]:
# SHIPPING_STANDARD_RATE_ID, SHIPPING_EXPRESS_RATE_ID, ALLOWED_ORIGINS
npx wrangler deploy
```
3) Edit `dripheads_site/config.js` with your Worker URL and PayPal client ID.

## Notes
- Checkout success redirects to `thanks.html?session_id=...` and the page fetches verified details via the Worker.
- Idempotency added to avoid duplicate Checkout Sessions on double-clicks.
- CORS defaults to `*`; restrict `ALLOWED_ORIGINS` for production.
