// Health monitor: checks critical services in background, shows toast alerts
const HEALTH_INTERVAL = 300000; // 5 min
const CHECK_TIMEOUT = 8000;

let _healthState = {}; // { "service": "ok"|"down"|"recovering" }
let _healthTimer = null;
let _healthCooldown = {}; // { "service": timestamp } – avoid spam

function healthToast(msg, isGood) {
  if (typeof toast === "function") toast(msg, isGood ? 2000 : 5000);
}

async function checkService(name, urlOrFn, opts) {
  const now = Date.now();
  const cooldown = _healthCooldown[name] || 0;
  try {
    const ok = typeof urlOrFn === "function" ? await urlOrFn() : await healthFetch(urlOrFn);
    if (ok) {
      if (_healthState[name] === "down") {
        _healthState[name] = "ok";
        if (now - cooldown > 30000) {
          healthToast(`✅ ${name} recuperado`, true);
          _healthCooldown[name] = now;
        }
      } else {
        _healthState[name] = "ok";
      }
    } else {
      throw new Error("check failed");
    }
  } catch (e) {
    if (_healthState[name] !== "down") {
      _healthState[name] = "down";
      if (now - cooldown > 60000) {
        healthToast(`⚠️ ${name} no responde`, false);
        _healthCooldown[name] = now;
      }
    }
  }
}

async function healthFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      signal: ctrl.signal,
    });
    return r.ok || r.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function runHealthCheck() {
  await Promise.all([
    checkService("Supabase", `${SB_URL}/rest/v1/partes?select=id&limit=1`),
    checkService("analyze-part", async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);
      try {
        const r = await fetch(`${SB_URL}/functions/v1/analyze-part`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
          body: JSON.stringify({ image: "test", provider: "groq", model: "test", prompt: "test" }),
          signal: ctrl.signal,
        });
        return r.ok || r.status === 503 || r.status === 400;
      } catch {
        return false;
      } finally { clearTimeout(t); }
    }),
    checkService("api-proxy", async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);
      try {
        const r = await fetch(`${SB_URL}/functions/v1/api-proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-write-token": writeToken || "test" },
          body: JSON.stringify({ table: "partes", method: "POST", body: {} }),
          signal: ctrl.signal,
        });
        return true; // any response means it's alive
      } catch {
        return false;
      } finally { clearTimeout(t); }
    }),
  ]);
}

function startHealthMonitor() {
  if (_healthTimer) return;
  runHealthCheck();
  _healthTimer = setInterval(runHealthCheck, HEALTH_INTERVAL);
}

// Auto-start when config is ready (wait for writeToken to be set)
(function() {
  const waitForConfig = setInterval(() => {
    if (typeof writeToken !== "undefined") {
      clearInterval(waitForConfig);
      startHealthMonitor();
    }
  }, 500);
  setTimeout(() => clearInterval(waitForConfig), 15000);
})();
