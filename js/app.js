let authed = false;
let searchFilter = "";
let loggingIn = false;

const ACTION_LABELS = { create:"Creada", update:"Editada", delete:"Eliminada", sale:"Vendida", reserve:"Reservada", release:"Liberada" };

async function init() {
  await loadSellerConfig();
  $("pw-btn").onclick = tryLogin;
  $("pw-input").onkeydown = e => { if (e.key === "Enter") tryLogin(); };
  let searchDebounce; $("ven-search").oninput = e => { searchFilter = e.target.value; clearTimeout(searchDebounce); searchDebounce = setTimeout(renderParts, 250); };
  $("ven-confirm").onclick = confirmSale;
  $("ven-cancel").onclick = () => closeModal("ven-modal");
  $("res-confirm").onclick = confirmReserve;
  $("res-cancel").onclick = () => closeModal("res-modal");
  $("refresh-btn").onclick = () => { loadAvailableParts().then(() => { renderParts(); updateStats(); toast("Actualizado"); }).catch(() => toast("Error al actualizar")); };
  $("history-btn").onclick = openMySales;
  $("hist-close-btn").onclick = () => closeModal("hist-modal");
}

function tryLogin() {
  if (loggingIn) return;
  const pin = $("pw-input").value.trim();
  const match = sellers.find(s => String(s.pin) === pin);
  if (match) {
    loggingIn = true;
    authed = true;
    sellerName = match.name || "Vendedor";
    $("pw-gate").classList.remove("on");
    $("app-main").classList.add("on");
    $("seller-name").textContent = sellerName;
    loadData();
  } else {
    $("pw-error").textContent = "PIN incorrecto";
    setTimeout(() => $("pw-error").textContent = "", 2000);
  }
}

async function loadData() {
  $("loading-state").classList.add("on");
  await loadAvailableParts();
  $("loading-state").classList.remove("on");
  renderParts();
  updateStats();
}

function renderParts() {
  const list = $("part-list"); list.innerHTML = "";
  const q = searchFilter.toLowerCase();
  let filtered = parts.filter(p => {
    const est = p.estado || (p.sold ? "vendida" : "disponible");
    if (est !== "disponible" && est !== "reservada") return false;
    if (q) {
      const s = [p.marca, p.modelo, p.categoria, p.posicion, p.ubicacion, p.descripcion, p.codigoOem].join(" ").toLowerCase();
      if (!s.includes(q)) return false;
    }
    return true;
  }).reverse();

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${q ? "Sin resultados" : "No hay partes disponibles"}</div>`;
    return;
  }

  filtered.forEach(p => {
    const est = p.estado || "disponible";
    const imgSrc = p.preview || p.previewFull || "";
    const card = document.createElement("div"); card.className = "part-card" + (est === "reservada" ? " part-card-reserva" : "");
    card.innerHTML = `<div class="part-card-img">${imgSrc ? `<img src="${escH(imgSrc)}" width="400" height="130" loading="lazy" alt="${escH(p.marca)} ${escH(p.modelo)}">` : `<div class="part-card-noimg">📦</div>`}</div>
      <div class="part-card-body">
        <div class="part-card-title">${escH(p.marca)} ${escH(p.modelo)}</div>
        <div class="part-card-meta">${escH(p.años)} · ${escH(p.posicion)} · ${escH(p.categoria)}</div>
        ${p.precioVenta ? `<div class="part-card-price">$${Number(p.precioVenta).toLocaleString("es-CL")}</div>` : ""}
        ${p.ubicacion ? `<div class="part-card-ubic">📍 ${escH(p.ubicacion)}</div>` : ""}
        ${est === "reservada" ? `<div class="part-card-resv-badge">Reservada</div>` : ""}
      </div>
      <div class="part-card-actions">
        <button class="pc-action" data-whatsapp title="WhatsApp" aria-label="WhatsApp">💬</button>
        <button class="pc-action" data-hist title="Historial" aria-label="Historial">📋</button>
      </div>`;
    if (est === "reservada") {
      card.onclick = () => openReleaseModal(p);
    } else {
      card.onclick = () => openSaleModal(p);
    }
    card.querySelector("[data-whatsapp]").onclick = (e) => { e.stopPropagation(); copyToClipboard(formatWhatsAppText(p)); };
    card.querySelector("[data-hist]").onclick = (e) => { e.stopPropagation(); showPartHistory(p); };
    list.appendChild(card);
  });
}

let _salePart = null;
let _reservePart = null;

function openSaleModal(part) {
  _salePart = part;
  $("ven-title").textContent = `${part.marca} ${part.modelo}`;
  $("ven-detail").textContent = `${part.años} · ${part.posicion} · ${part.categoria}`;
  $("ven-price").value = part.precioVenta ?? "";
  $("ven-price").focus();
  $("ven-modal").classList.add("on");
}

async function confirmSale() {
  if (!_salePart) return;
  const raw = $("ven-price").value.replace(/\./g, '').replace(',', '.');
  const price = parseFloat(raw);
  if (!price || price <= 0) { toast("Ingresá un precio válido"); return; }
  const btn = $("ven-confirm"); btn.disabled = true; btn.textContent = "Guardando…";
  try {
    await recordSale(_salePart, price, sellerName);
    const idx = parts.findIndex(p => p.id === _salePart.id);
    if (idx > -1) parts.splice(idx, 1);
    closeModal("ven-modal");
    renderParts();
    updateStats();
    toast(`Vendido: ${_salePart.marca} ${_salePart.modelo} por $${price.toLocaleString("es-CL")}`);
  } catch(e) {
    toast("Error al guardar la venta");
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = "Confirmar Venta";
  }
}

function openReserveModal(part) {
  _reservePart = part;
  $("res-title").textContent = `${part.marca} ${part.modelo}`;
  $("res-cliente").value = "";
  $("res-telefono").value = "";
  $("res-nota").value = "";
  $("res-modal").classList.add("on");
  setTimeout(() => $("res-cliente").focus(), 100);
}

async function confirmReserve() {
  if (!_reservePart) return;
  const nom = $("res-cliente").value.trim();
  const tel = $("res-telefono").value.trim();
  if (!nom || !tel) { toast("Nombre y teléfono requeridos"); return; }
  const btn = $("res-confirm"); btn.disabled = true; btn.textContent = "Reservando…";
  try {
    const ok = await reservePart(_reservePart, nom, tel, $("res-nota").value.trim());
    if (ok) {
      closeModal("res-modal");
      toast(`Reservada: ${_reservePart.marca} ${_reservePart.modelo}`);
      renderParts();
      updateStats();
    } else {
      toast("Error al reservar");
    }
  } catch(e) {
    toast("Error al reservar");
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = "Confirmar Reserva";
  }
}

function openReleaseModal(part) {
  _reservePart = part;
  $("res-title").textContent = `Liberar: ${part.marca} ${part.modelo}`;
  $("res-cliente").value = "";
  $("res-telefono").value = "";
  $("res-nota").value = "";
  $("res-confirm").textContent = "Liberar";
  $("res-confirm").onclick = async () => {
    $("res-confirm").disabled = true;
    $("res-confirm").textContent = "Liberando…";
    try {
      const ok = await releaseReservation(part);
      if (ok) {
        closeModal("res-modal");
        toast(`Liberada: ${part.marca} ${part.modelo}`);
        renderParts();
        updateStats();
      } else {
        toast("Error al liberar");
      }
    } catch(e) {
      toast("Error al liberar");
      console.error(e);
    } finally {
      $("res-confirm").disabled = false;
      $("res-confirm").textContent = "Liberar";
      $("res-confirm").onclick = confirmReserve;
    }
  };
  $("res-modal").classList.add("on");
}

function updateStats() {
  const disponibles = parts.filter(p => (p.estado||(p.sold?"vendida":"disponible"))==="disponible").length;
  const reservadas = parts.filter(p => (p.estado||"disponible")==="reservada").length;
  $("stat-disponibles").textContent = disponibles;
  $("stat-reservadas").textContent = reservadas;
}

function closeModal(id) { $(id).classList.remove("on"); }

function toast(msg) {
  const el = $("toast");
  const msgEl = $("toast-msg");
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.classList.add("on");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3000);
}

async function openMySales() {
  const list = $("hist-list");
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t4);font-size:12px">Cargando…</div>';
  $("hist-modal").classList.add("on");
  try {
    const sales = await loadMySales(sellerName);
    if (!sales.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--t4);font-size:12px">Aún no registraste ventas.</div>';
      return;
    }
    const total = sales.reduce((s, v) => s + (v.total || 0), 0);
    $("hist-sub").textContent = `${sales.length} ventas · $${Math.round(total).toLocaleString("es-CL")} total`;
    list.innerHTML = sales.map(v => {
      const items = (v.items || []).map(it => `${it.marca} ${it.modelo}`).join(", ");
      return `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--bdr);align-items:flex-start">
        <span style="font-size:9px;color:var(--t4);white-space:nowrap">${v.fecha || ""}</span>
        <span style="font-size:11px;flex:1">${escH(items)}</span>
        <span style="font-size:12px;font-weight:700;color:var(--gold)">$${Math.round(v.total||0).toLocaleString("es-CL")}</span>
      </div>`;
    }).join("");
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red-lt);font-size:12px">Error al cargar ventas</div>';
    console.error(e);
  }
}

async function showPartHistory(part) {
  const bg = document.createElement("div"); bg.className = "modal-bg on"; bg.id = "hist-part-modal";
  bg.innerHTML = `<div class="modal-sheet" style="max-width:450px">
    <div class="modal-title">Historial: ${escH(part.marca)} ${escH(part.modelo)}</div>
    <div class="modal-sub">Últimos movimientos</div>
    <div id="hist-part-content" style="max-height:60vh;overflow-y:auto;margin-bottom:12px"><div style="text-align:center;padding:20px;color:var(--t4);font-size:12px">Cargando…</div></div>
    <div class="modal-btns"><button class="btn-ghost-sm" id="hist-part-close">Cerrar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const closeBtn = document.getElementById("hist-part-close");
  if (closeBtn) closeBtn.onclick = () => bg.remove();
  const content = document.getElementById("hist-part-content");
  if (!content) return;
  try {
    const logs = await loadPartHistory(part.id);
    if (!logs || logs.length === 0) {
      content.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--t4);font-size:12px">Sin movimientos registrados.</div>';
      return;
    }
    content.innerHTML = logs.map(l => {
      const ts = l.timestamp ? new Date(l.timestamp.endsWith("Z")||l.timestamp.includes("+")?l.timestamp:l.timestamp+"Z").toLocaleString("es-CL") : "???";
      const action = ACTION_LABELS[l.action] || l.action;
      return `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--bdr);align-items:flex-start">
        <span style="white-space:nowrap;font-size:9px;color:var(--t4);min-width:60px">${ts}</span>
        <span style="font-size:10px;color:var(--t3)">${action}</span>
      </div>`;
    }).join("");
  } catch(e) {
    if (content) content.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red-lt);font-size:12px">Error al cargar historial</div>';
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);
