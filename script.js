
// Cart + Payments helpers
const CART_KEY = "dripheads_cart_v1";
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

function cfg(){ return window.PAY_CONFIG || {stripe:{paymentLinkById:{}, defaultLink:""}, paypal:{clientId:"", currency:"USD"}, cloudflare:{workerUrl:""}}; }

function loadCart(){ try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch(e){ return []; } }
function saveCart(items){ localStorage.setItem(CART_KEY, JSON.stringify(items)); updateCartCount(); }
function updateCartCount(){
  const count = loadCart().reduce((n,i)=> n + (i.qty||1), 0);
  $$(".cart-pill").forEach(el => el.textContent = count);
}
function addToCart(item){
  if(!item || !item.id){ console.warn("addToCart: missing item/id", item); return; }
  const cart = loadCart();
  const exist = cart.find(i => i.id === item.id);
  if(exist){ exist.qty = (exist.qty||1) + (item.qty||1); }
  else { cart.push({ id:item.id, name:item.name||"Item", price:Number(item.price)||0, qty:item.qty||1, image:item.image||"" }); }
  saveCart(cart);
  toast(`${item.name || "Item"} added to cart`);
}
function removeFromCart(id){ const cart = loadCart().filter(i => i.id !== id); saveCart(cart); renderCart(); }
function setQty(id, qty){
  qty = Math.max(1, Number(qty)||1);
  const cart = loadCart();
  const it = cart.find(i => i.id === id);
  if(it){ it.qty = qty; saveCart(cart); renderCart(); }
}
function clearCart(){ saveCart([]); renderCart(); }
function formatUsd(n){ return `$${(Number(n)||0).toFixed(2)}`; }
function cartSubtotal(){ return loadCart().reduce((s,i)=> s + (i.price||0)*(i.qty||1), 0); }

function renderCart(){
  const tableBody = $("#cart-rows");
  const subtotalEl = $("#cart-subtotal");
  if(!tableBody || !subtotalEl) return;
  const cart = loadCart();
  tableBody.innerHTML = "";
  let subtotal = 0;
  for(const i of cart){
    const total = (i.price||0) * (i.qty||1);
    subtotal += total;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="cart-name">
        <div class="row">
          ${i.image ? `<img class="thumb" src="${i.image}" alt="">` : ""}
          <div>
            <div class="name">${i.name || ""}</div>
            <button class="link danger" data-remove="${i.id}">Remove</button>
          </div>
        </div>
      </td>
      <td>${formatUsd(i.price)}</td>
      <td><input data-qty="${i.id}" type="number" min="1" value="${i.qty||1}" class="qty-input"></td>
      <td>${formatUsd(total)}</td>`;
    tableBody.appendChild(row);
  }
  subtotalEl.textContent = formatUsd(subtotal);

  $$("button[data-remove]").forEach(b => b.addEventListener("click", () => removeFromCart(b.getAttribute("data-remove"))));
  $$("input[data-qty]").forEach(inp => inp.addEventListener("input", () => setQty(inp.getAttribute("data-qty"), inp.value)));
}

function toast(msg){
  let t = $("#toast");
  if(!t){
    t = document.createElement("div");
    t.id = "toast";
    t.style.position = "fixed";
    t.style.bottom = "1rem";
    t.style.right = "1rem";
    t.style.padding = "10px 14px";
    t.style.borderRadius = "12px";
    t.style.boxShadow = "0 8px 20px rgba(0,0,0,.25)";
    t.style.background = "white";
    t.style.fontWeight = "600";
    t.style.zIndex = "9999";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  setTimeout(()=>{ t.style.opacity = "0"; }, 1400);
}

// Auto-bind buttons with data-add-to-cart attributes
function bindAddToCart(){
  $$("[data-add-to-cart]").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = {
        id: btn.getAttribute("data-id"),
        name: btn.getAttribute("data-name"),
        price: Number(btn.getAttribute("data-price")),
        qty: Number(btn.getAttribute("data-qty") || "1"),
        image: btn.getAttribute("data-image") || ""
      };
      addToCart(item);
    });
  });
}

// ---- Cloudflare Worker Multi-item Stripe Checkout ----
async function openStripeCheckout(){
  const cart = loadCart();
  if(!cart.length){ alert("Your cart is empty."); return; }
  const worker = (cfg().cloudflare && cfg().cloudflare.workerUrl) || "";
  if(!worker){
    // Fallback to single-item Payment Links if configured
    const conf = cfg().stripe || {paymentLinkById:{}, defaultLink:""};
    if(cart.length === 1){
      const it = cart[0];
      const link = (conf.paymentLinkById && conf.paymentLinkById[it.id]) || conf.defaultLink;
      if(link){
        const qty = it.qty || 1;
        const url = qty > 1 ? `${link}${link.includes('?') ? '&' : '?'}quantity=${encodeURIComponent(qty)}` : link;
        window.location.href = url; return;
      }
    }
    alert("Stripe multi-item checkout requires the Cloudflare Worker URL in config.js.");
    return;
  }
  const successUrl = new URL("thanks.html", window.location.href).toString();
  const cancelUrl  = new URL("checkout.html", window.location.href).toString();
  try{
    const res = await fetch(worker.replace(/\/$/, '') + "/create-checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: cart.map(i => ({ id: i.id, qty: i.qty })), success_url: successUrl, cancel_url: cancelUrl })
    });
    if(!res.ok){ console.error(await res.text()); alert("Problem creating Stripe checkout — check Worker logs."); return; }
    const data = await res.json();
    if(data && data.url){ window.location.href = data.url; } else { alert("No checkout URL returned."); }
  }catch(err){ console.error(err); alert("Network error contacting Cloudflare Worker."); }
}

// ---- PayPal/Venmo Buttons ----
function loadPayPalSDK(){
  const conf = cfg().paypal || {clientId:"", currency:"USD"};
  if(!conf.clientId){ return Promise.resolve(false); }
  return new Promise((resolve) => {
    if(window.paypal){ resolve(true); return; }
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(conf.clientId)}&components=buttons,hosted-fields&enable-funding=venmo&currency=${encodeURIComponent(conf.currency||"USD")}`;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

async function setupPayPalButtons(){
  const ok = await loadPayPalSDK();
  const container = $("#paypal-buttons");
  if(!container){ return; }
  if(!ok){ container.style.display = "none"; return; }
  const currency = (cfg().paypal && cfg().paypal.currency) || "USD";
  const total = cartSubtotal().toFixed(2);

  paypal.Buttons({
    style: { layout: 'vertical', shape: 'pill' },
    createOrder: (data, actions) => {
      const cart = loadCart();
      const items = cart.map(i => ({
        name: i.name,
        unit_amount: { currency_code: currency, value: (i.price||0).toFixed(2) },
        quantity: String(i.qty||1)
      }));
      const amount = {
        currency_code: currency,
        value: total,
        breakdown: { item_total: { currency_code: currency, value: total } }
      };
      return actions.order.create({ purchase_units: [{ amount, items }] });
    },
    onApprove: (data, actions) => actions.order.capture().then(function(details){
      clearCart(); toast("Payment completed ✔"); window.location.href = "thanks.html";
    }),
    onError: (err) => { console.error(err); alert("PayPal error — check console and your client ID."); }
  }).render("#paypal-buttons");
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();
  bindAddToCart();
  renderCart();
  if(document.getElementById("paypal-buttons")) setupPayPalButtons();
});
