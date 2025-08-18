async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s=>s.trim()).filter(Boolean);
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : ""),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", ...corsHeaders }});
    }

    // Verified success page: fetch Checkout Session details
    if (url.pathname === "/checkout-session" && request.method === "GET") {
      if (!env.STRIPE_SECRET_KEY) return new Response(JSON.stringify({ error: "Missing STRIPE_SECRET_KEY" }), { status: 500, headers: { "content-type": "application/json", ...corsHeaders } });
      const session_id = url.searchParams.get("session_id") || "";
      if (!/^cs_(test|live)_[A-Za-z0-9]+/.test(session_id)) {
        return new Response(JSON.stringify({ error: "Invalid session_id" }), { status: 400, headers: { "content-type": "application/json", ...corsHeaders } });
      }
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}?expand[]=line_items`, {
        headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      const data = await r.json();
      if (!r.ok) return new Response(JSON.stringify({ error: data.error || data }), { status: 500, headers: { "content-type": "application/json", ...corsHeaders } });
      const out = {
        id: data.id,
        amount_total: data.amount_total,
        currency: data.currency,
        customer_details: data.customer_details,
        shipping_details: data.shipping_details,
        shipping_cost: data.shipping_cost,
        automatic_tax: data.automatic_tax,
        payment_status: data.payment_status,
        status: data.status,
        line_items: (data.line_items && data.line_items.data || []).map(li => ({
          description: li.description,
          quantity: li.quantity,
          amount_subtotal: li.amount_subtotal,
          amount_total: li.amount_total,
          currency: li.currency
        })),
        created: data.created
      };
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", ...corsHeaders } });
    }

    if (url.pathname === "/create-checkout-session" && request.method === "POST") {
      if (!env.STRIPE_SECRET_KEY) return new Response(JSON.stringify({ error: "Missing STRIPE_SECRET_KEY" }), { status: 500, headers: { "content-type": "application/json", ...corsHeaders } });
      const body = await request.json().catch(()=> ({}));
      const items = Array.isArray(body.items) ? body.items : [];
      let success_url = (body.success_url || "").toString() || "https://example.com/thanks.html";
      const cancel_url  = (body.cancel_url || "").toString()  || "https://example.com/checkout.html";

      // Ensure success URL includes session_id
      const token = "{CHECKOUT_SESSION_ID}";
      success_url += (success_url.includes("?") ? "&" : "?") + "session_id=" + token;

      let priceMap = {};
      if (env.PRICE_MAP_JSON) { try { priceMap = JSON.parse(env.PRICE_MAP_JSON); } catch(e){} }
      const FALLBACK = {};
      priceMap = { ...FALLBACK, ...priceMap };

      if (!items.length) return new Response(JSON.stringify({ error: "Cart is empty" }), { status: 400, headers: { "content-type": "application/json", ...corsHeaders } });

      const line_items = [];
      for (const it of items) {
        const pid = it.id;
        const qty = Math.max(1, parseInt(it.qty || 1, 10));
        const price = priceMap[pid];
        if (!price) return new Response(JSON.stringify({ error: `Missing Stripe price for product id: ${pid}` }), { status: 400, headers: { "content-type": "application/json", ...corsHeaders } });
        line_items.push({ price, quantity: qty });
      }

      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("success_url", success_url);
      params.append("cancel_url", cancel_url);
      params.append("automatic_tax[enabled]", "true");
      params.append("billing_address_collection", "auto");
      params.append("customer_creation", "always");
      params.append("allow_promotion_codes", "true");
      params.append("shipping_address_collection[allowed_countries][]", "US");
      // Use Shipping Rate IDs if present, otherwise fixed amounts
      if (env.SHIPPING_STANDARD_RATE_ID) {
        params.append("shipping_options[0][shipping_rate]", env.SHIPPING_STANDARD_RATE_ID);
      } else {
        params.append("shipping_options[0][shipping_rate_data][display_name]", "Standard (3–7 days)");
        params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
        params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(env.SHIPPING_STANDARD_AMOUNT || 800));
        params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
      }
      if (env.SHIPPING_EXPRESS_RATE_ID) {
        params.append("shipping_options[1][shipping_rate]", env.SHIPPING_EXPRESS_RATE_ID);
      } else {
        params.append("shipping_options[1][shipping_rate_data][display_name]", "Express (1–3 days)");
        params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
        params.append("shipping_options[1][shipping_rate_data][fixed_amount][amount]", String(env.SHIPPING_EXPRESS_AMOUNT || 1800));
        params.append("shipping_options[1][shipping_rate_data][fixed_amount][currency]", "usd");
      }
      params.append("phone_number_collection[enabled]", "true");

      line_items.forEach((li, idx) => {
        params.append(`line_items[${idx}][price]`, li.price);
        params.append(`line_items[${idx}][quantity]`, String(li.quantity));
      });
      try { params.append("metadata[cart_json]", JSON.stringify(items).slice(0, 499)); } catch(e){}

      // Idempotency key for 30s window
      const minutesBucket = Math.floor(Date.now() / 30000);
      const idemSeed = JSON.stringify({ items, success_url, cancel_url, ua: request.headers.get("User-Agent") || "", b: minutesBucket });
      const idemKey = "cs_" + await sha256Hex(idemSeed);

      const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": idemKey
        },
        body: params.toString()
      });
      const data = await resp.json();
      if (!resp.ok) return new Response(JSON.stringify({ error: data.error || data }), { status: 500, headers: { "content-type": "application/json", ...corsHeaders } });
      return new Response(JSON.stringify({ id: data.id, url: data.url }), { headers: { "content-type": "application/json", ...corsHeaders } });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};