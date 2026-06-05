const SB_URL = "https://xkguzluwbbxsbustlcxo.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZ3V6bHV3YmJ4c2J1c3RsY3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzQwOTUsImV4cCI6MjA5NTc1MDA5NX0.N6oatsQFuRPdlpKcwWnqNSvagtg1dGqjSNg2dzU9Tl0";

let sellerPin = "1234";
let sellerName = "";
let parts = [];
let deviceId = "ven-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);

function $(id) { return document.getElementById(id); }
function escH(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

async function sbFetch(path, method = "GET", body = null) {
  try {
    const opt = { method, headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" } };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(SB_URL + path, opt);
    if (!r.ok) { const t = await r.text().catch(()=>""); console.warn("sbFetch", r.status, t.slice(0,200)); return null; }
    if (method === "DELETE") return true;
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
  const data = await sbFetch("/rest/v1/config?select=value&name=eq.seller_config");
  if (data && data.length && data[0].value) {
    const cfg = data[0].value;
    if (cfg.pin) sellerPin = String(cfg.pin);
  }
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
