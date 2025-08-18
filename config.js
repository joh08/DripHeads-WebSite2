// Replace placeholders before deploying.
window.PAY_CONFIG = {
  stripe: { paymentLinkById: { }, defaultLink: "" },
  paypal: { clientId: "", currency: "USD" },
  cloudflare: { workerUrl: "" } // e.g., https://dripheads-checkout.<you>.workers.dev
};
