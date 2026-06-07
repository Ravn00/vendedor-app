const SB_URL = "https://xkguzluwbbxsbustlcxo.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZ3V6bHV3YmJ4c2J1c3RsY3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzQwOTUsImV4cCI6MjA5NTc1MDA5NX0.N6oatsQFuRPdlpKcwWnqNSvagtg1dGqjSNg2dzU9Tl0";

let sellers = [{ name: "Vendedor", pin_hash: "5af4c93ae18a5897300213c749b7c91d69be433e5e73ece1e1866ee57ff2167d" }];


let sellerName = "";
let parts = [];
let deviceId = "ven-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
let writeToken = "";
const COMMISSION_RATE = 0.1;
const SESSION_DURATION = 3600000;
let salesTotal = 0;
let commissionTotal = 0;
let historicalSalesTotal = 0;
let historicalCommission = 0;
let pendingCommission = 0;
let lastPaidAt = null;

function getSessionUser() {
  try { const d = JSON.parse(localStorage.getItem("authSession")); return d && d.expiry > Date.now() ? d : null; } catch { return null; }
}
function saveSession(name) { localStorage.setItem("authSession", JSON.stringify({ name, expiry: Date.now() + SESSION_DURATION })); }
function clearSession() { localStorage.removeItem("authSession"); }



async function loadSellerConfig() {
  const data = await sbFetch("/rest/v1/admin_config?select=*&limit=1");
  if (data && data.length && data[0]) {
    const cfg = data[0];
    if (cfg.sellers && Array.isArray(cfg.sellers) && cfg.sellers.length) sellers = cfg.sellers;
    writeToken = cfg.write_token || "";
  }
  refreshLastPaidAt();
}

function refreshLastPaidAt() {
  const match = sellers.find(s => s.name === sellerName);
  lastPaidAt = match?.last_paid_at || null;
}

function formatWhatsAppText(p) {
  const est = p.estado || (p.sold ? "vendida" : "disponible");
  return [
    `*Producto:* ${p.marca} ${p.modelo}`,
    `*Compatibilidad:* ${p.años || ""}${p.posicion ? " · " + p.posicion : ""}`,
    `${p.ubicacion ? `*Ubicación:* ${p.ubicacion}` : ""}`,
    `${p.precioVenta ? `*Precio:* $${Number(p.precioVenta).toLocaleString("es-CL")}` : ""}`,
    `*Estado:* ${est.charAt(0).toUpperCase() + est.slice(1)}`,
    `${p.descripcion ? `\n${p.descripcion}` : ""}`
  ].filter(Boolean).join("\n");
}


