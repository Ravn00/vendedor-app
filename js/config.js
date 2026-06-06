const SB_URL = "https://xkguzluwbbxsbustlcxo.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZ3V6bHV3YmJ4c2J1c3RsY3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzQwOTUsImV4cCI6MjA5NTc1MDA5NX0.N6oatsQFuRPdlpKcwWnqNSvagtg1dGqjSNg2dzU9Tl0";

let sellers = [{ name: "Vendedor", pin: "1234" }];
let sellerName = "";
let parts = [];
let deviceId = "ven-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
let writeToken = "";

function $(id) { return document.getElementById(id); }
function escH(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

async function sbFetch(path, method = "GET", body = null) {
  try {
    const opt = { method, headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" } };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(SB_URL + path, opt);
    if (!r.ok) { const t = await r.text().catch(()=>""); console.warn("sbFetch", r.status, t.slice(0,200)); return null; }
    if (method === "DELETE" || method === "PATCH") return true;
    const ct = r.headers.get("content-type")||"";
    if (ct.includes("json")) return r.json();
    return r.text();
  } catch(e) { console.warn("sbFetch error:", e); return null; }
}

async function sbFetchAll(path) {
  let all = [], page = 0, pageSize = 1000;
  while (true) {
    const offset = page * pageSize;
    const url = `${path}&offset=${offset}&limit=${pageSize}`;
    const data = await sbFetch(url, "GET");
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return all;
}

async function loadSellerConfig() {
  const data = await sbFetch("/rest/v1/admin_config?select=*&limit=1");
  if (data && data.length && data[0]) {
    const cfg = data[0];
    if (cfg.sellers && Array.isArray(cfg.sellers) && cfg.sellers.length) sellers = cfg.sellers;
    writeToken = cfg.write_token || "";
  }
}

async function apiProxy(table, method, body, query) {
  if (!writeToken) { console.warn("apiProxy: no write token"); return null; }
  try {
    const res = await fetch(`${SB_URL}/functions/v1/api-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-write-token": writeToken },
      body: JSON.stringify({ table, method, body, query: query || "" })
    });
    if (!res.ok) { console.warn("apiProxy error:", res.status); return null; }
  return true;
}

async function resetAllData() {
  const step1 = confirm("⚠️ RESET TOTAL\n\nEsto eliminará TODOS los datos:\n• Catálogo completo\n• Ventas registradas\n• Historial de escaneos\n• Dispositivos\n• Configuración\n\n¿Estás seguro?");
  if (!step1) return;
  const step2 = confirm("ÚLTIMA ADVERTENCIA\n\nEsta acción NO se puede deshacer.\nTodo el localStorage y los datos en Supabase serán eliminados.\n\n¿Confirmas?");
  if (!step2) return;
  localStorage.clear();
  if (writeToken) {
    try {
      await fetch(`${SB_URL}/functions/v1/api-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-write-token": writeToken },
        body: JSON.stringify({ action: "reset-all" })
      });
    } catch(e) { console.warn("reset-all error:", e); }
  }
  location.reload();
}


async function sbLogAudit(partId, action, changes) {
  try {
    await fetch(`${SB_URL}/rest/v1/partes_log`, {
      method: "POST",
      headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ part_id: partId, action, changes: JSON.stringify(changes || {}), device_id: deviceId, timestamp: new Date().toISOString() })
    });
  } catch(_) {}
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

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast("Copiado al portapapeles")).catch(() => fallbackCopy(text));
  } else { fallbackCopy(text); }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast("Copiado"); } catch(_) { toast("Error al copiar"); }
  document.body.removeChild(ta);
}

function openLightbox(src) { $("lb-img").src = src; $("lightbox").classList.add("on"); }
function closeLightbox() { $("lightbox").classList.remove("on"); $("lb-img").src = ""; }
