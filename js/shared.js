// Shared utilities — V-CAP
function $(id) { return document.getElementById(id); }
function escH(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  const msgEl = $("toast-msg") || el.querySelector(".toast-msg");
  if (msgEl) msgEl.textContent = msg;
  el.classList.add("on");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3000);
}

async function sbFetch(path, method = "GET", body = null, showError = true) {
  try {
    const opt = { method, headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" } };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(SB_URL + path, opt);
    if (!r.ok) {
      if (r.status === 409) return null;
      const t = await r.text().catch(()=>"");
      const msg = `Error ${r.status}: ${t.slice(0,80)}`;
      console.warn("sbFetch", r.status, t.slice(0,200));
      if (showError) toast(msg);
      return null;
    }
    if (method === "DELETE" || method === "PATCH" || r.status === 204) return true;
    const ct = r.headers.get("content-type")||"";
    if (ct.includes("json")) return r.json();
    return r.text();
  } catch(e) {
    console.warn("sbFetch error:", e);
    if (showError) toast("Error de red: " + e.message);
    return null;
  }
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

async function getHash(str) {
  try {
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
    }
  } catch(_) {}
  return sha256(str);
}

function sha256(str) {
  const chrsz = 8;
  function safe_add(x, y) { const lsw = (x & 0xFFFF) + (y & 0xFFFF); return (x >>> 16) + (y >>> 16) + (lsw >>> 16) << 16 | lsw & 0xFFFF; }
  function S(X, n) { return X >>> n; } function R(X, n) { return X << n >>> 0; }
  function Ch(x, y, z) { return x & y ^ ~x & z; } function Maj(x, y, z) { return x & y ^ x & z ^ y & z; }
  function Sigma0256(x) { return S(x, 2) ^ S(x, 13) ^ S(x, 22); } function Sigma1256(x) { return S(x, 6) ^ S(x, 11) ^ S(x, 25); }
  function Gamma0256(x) { return S(x, 7) ^ S(x, 18) ^ R(x, 3); } function Gamma1256(x) { return S(x, 17) ^ S(x, 19) ^ R(x, 10); }
  const K = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
  const l = str.length * chrsz; const m = [];
  for (let i = 0; i < l; i += chrsz) m[i>>5] |= (str.charCodeAt(i / chrsz) & 0xFF) << (24 - i % 32);
  m[l>>5] |= 0x80 << (24 - l % 32); m[((l + 64 >> 9) << 4) + 15] = l;
  let H = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
  for (let i = 0; i < m.length; i += 16) {
    const W = new Array(64);
    for (let t = 0; t < 16; t++) W[t] = m[i + t];
    for (let t = 16; t < 64; t++) W[t] = safe_add(safe_add(safe_add(Gamma1256(W[t - 2]), W[t - 7]), Gamma0256(W[t - 15])), W[t - 16]);
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const T1 = safe_add(safe_add(safe_add(safe_add(h, Sigma1256(e)), Ch(e, f, g)), K[t]), W[t]);
      const T2 = safe_add(Sigma0256(a), Maj(a, b, c));
      h = g; g = f; f = e; e = safe_add(d, T1); d = c; c = b; b = a; a = safe_add(T1, T2);
    }
    H[0] = safe_add(H[0], a); H[1] = safe_add(H[1], b); H[2] = safe_add(H[2], c); H[3] = safe_add(H[3], d);
    H[4] = safe_add(H[4], e); H[5] = safe_add(H[5], f); H[6] = safe_add(H[6], g); H[7] = safe_add(H[7], h);
  }
  return H.map(x => ("0123456789abcdef").split("").reduce((s, _, i) => s + "0123456789abcdef"[(x >>> (7 - i) * 4) & 15], "")).join("");
}

function openLightbox(src) { $("lb-img").src = src; $("lightbox").classList.add("on"); }
function closeLightbox() { $("lightbox").classList.remove("on"); $("lb-img").src = ""; }

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
  } catch(e) { console.warn("apiProxy error:", e.message); return null; }
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

async function resetAllData() {
  if (!confirm("⚠️ RESET TOTAL\n\nEsto eliminará TODOS los datos:\n• Catálogo completo\n• Ventas registradas\n• Historial de escaneos\n• Dispositivos\n• Configuración\n\n¿Estás seguro?")) return;
  if (!confirm("ÚLTIMA ADVERTENCIA\n\nEsta acción NO se puede deshacer.\nTodo el localStorage y los datos en Supabase serán eliminados.\n\n¿Confirmas?")) return;
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
