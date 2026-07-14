let authed = false;
let searchFilter = "";
let loggingIn = false;
const PAGE_SIZE = 50;
let visibleCount = PAGE_SIZE;

const ACTION_LABELS = { create:"Creada", update:"Editada", delete:"Eliminada", sale:"Vendida", reserve:"Reservada", release:"Liberada" };

async function init() {
  await loadSellerConfig();

  // Session check: auto-login si la sesión sigue vigente
  const session = getSessionUser();
  if (session && session.name && sellers.some(s => s.name === session.name)) {
    authed = true;
    sellerName = session.name;
    refreshLastPaidAt();
    $("pw-gate").classList.remove("on");
    $("app-main").classList.add("on");
    $("seller-name").textContent = sellerName;
    loadData();
  } else {
    clearSession();
    $("pw-btn").onclick = tryLogin;
    $("pw-input").onkeydown = e => { if (e.key === "Enter") tryLogin(); };
  }

  let searchDebounce; $("ven-search").oninput = e => { searchFilter = e.target.value; visibleCount = PAGE_SIZE; clearTimeout(searchDebounce); searchDebounce = setTimeout(renderParts, 250); };
  $("ven-confirm").onclick = confirmSale;
  $("ven-cancel").onclick = () => closeModal("ven-modal");
  $("lote-confirm").onclick = confirmLoteSale;
  $("lote-cancel").onclick = () => { closeLoteModal(); };
  $("res-confirm").onclick = confirmReserve;
  $("res-cancel").onclick = () => closeModal("res-modal");
  $("lote-btn").onclick = () => openLoteModal();
  $("refresh-btn").onclick = () => { Promise.all([loadAvailableParts(), loadSalesStats()]).then(() => { renderParts(); updateStats(); toast("Actualizado"); }).catch(() => toast("Error al actualizar")); };
  $("history-btn").onclick = openMySales;
  $("hist-close-btn").onclick = () => closeModal("hist-modal");

  // Refrescar sesión en cada interacción
  const refresh = () => { if (authed) saveSession(sellerName); };
  document.addEventListener("click", refresh);
  document.addEventListener("keydown", refresh);

  // Auto-sync cada 30 segundos
  setInterval(autoSync, 30000);
  setInterval(reloadLastPaidAt, 30000);
}

async function autoSync() {
  if (!authed) return;
  try {
    await loadAvailableParts();
    renderParts();
    updateStats();
    await loadSalesStats();
    saveSalesStatsCache();
  } catch(e) { console.warn("autoSync error:", e); }
}

async function reloadLastPaidAt() {
  if (!authed) return;
  try {
    const data = await apiProxyRead("admin_config", "sellers", "&limit=1");
    if (data && data.length && data[0]?.sellers) {
      sellers = data[0].sellers;
      refreshLastPaidAt();
    }
  } catch(_) {}
}

async function tryLogin() {
  if (loggingIn) return;
  loggingIn = true;
  const pin = $("pw-input").value.trim();
  const pinHash = await getHash(pin);
  const match = sellers.find(s => s.pin_hash === pinHash) || sellers.find(s => s.pin === pin);
  if (match) {
    authed = true;
    sellerName = match.name || "Vendedor";
    refreshLastPaidAt();
    saveSession(sellerName);
    $("pw-gate").classList.remove("on");
    $("app-main").classList.add("on");
    $("seller-name").textContent = sellerName;
    loadData();
  } else {
    $("pw-error").textContent = "PIN incorrecto";
    setTimeout(() => $("pw-error").textContent = "", 2000);
    loggingIn = false;
  }
}

async function loadData() {
  $("loading-state").classList.add("on");
  loadSalesStatsFromCache();
  await loadAvailableParts();
  try { await loadSalesStats(); } catch(e) { console.warn("loadSalesStats error:", e); }
  $("loading-state").classList.remove("on");
  renderParts();
  updateStats();
}

function loadSalesStatsFromCache() {
  try {
    const c = JSON.parse(localStorage.getItem("vcap_stats") || "{}");
    if (c.histTotal) { historicalSalesTotal = c.histTotal; historicalCommission = c.histComm; pendingCommission = c.pendComm || 0; updateCommissionDisplay(); }
  } catch(_) {}
}

function saveSalesStatsCache() {
  try { localStorage.setItem("vcap_stats", JSON.stringify({ histTotal: historicalSalesTotal, histComm: historicalCommission, pendComm: pendingCommission })); } catch(_) {}
}

async function loadSalesStats() {
  loadSalesStatsFromCache();
  const sales = await loadMySales(sellerName);
  historicalSalesTotal = sales.reduce((s, v) => s + (v.total || 0), 0);
  historicalCommission = sales.reduce((s, v) => s + (v.comision || Math.round((v.total || 0) * COMMISSION_RATE)), 0);

  const since = lastPaidAt ? new Date(lastPaidAt).getTime() : 0;
  pendingCommission = sales
    .filter(v => {
      const t = v.created_at ? new Date(v.created_at.endsWith("Z")||v.created_at.includes("+")?v.created_at:v.created_at+"Z").getTime() : 0;
      return t > since;
    })
    .reduce((s, v) => s + (v.comision || Math.round((v.total || 0) * COMMISSION_RATE)), 0);

  updateCommissionDisplay();
  saveSalesStatsCache();
}

function updateCommissionDisplay() {
  $("stat-vendido").textContent = Math.round(historicalSalesTotal).toLocaleString("es-CL");
  $("stat-comision").textContent = Math.round(pendingCommission).toLocaleString("es-CL");
  if (lastPaidAt) {
    const d = new Date(lastPaidAt.endsWith("Z")||lastPaidAt.includes("+")?lastPaidAt:lastPaidAt+"Z");
    $("stat-lastpay").textContent = d.toLocaleDateString("es-CL");
    $("sbar-lastpay").style.display = "";
  } else {
    $("sbar-lastpay").style.display = "none";
  }
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

  const shown = filtered.slice(0, visibleCount);
  shown.forEach(p => {
    const est = p.estado || "disponible";
    const imgSrc = p.preview || p.previewFull || "";
    const card = document.createElement("div"); card.className = "part-card" + (est === "reservada" ? " part-card-reserva" : "");
    card.innerHTML = `<div class="part-card-img">${imgSrc ? `<img src="${escH(imgSrc)}" width="400" height="130" loading="lazy" alt="${escH(p.marca)} ${escH(p.modelo)}" data-img="${escH(imgSrc)}">` : `<div class="part-card-noimg">📦</div>`}</div>
      <div class="part-card-body">
        <div class="part-card-title">${escH(p.marca)} ${escH(p.modelo)}</div>
        <div class="part-card-meta">${escH(p.años)} · ${escH(p.posicion)} · ${escH(p.categoria)}</div>
        ${p.precioVenta ? `<div class="part-card-price">$${Number(p.precioVenta).toLocaleString("es-CL")}</div>` : ""}
        ${p.ubicacion ? `<div class="part-card-ubic">📍 ${escH(p.ubicacion)}</div>` : ""}
        ${(p.stock && p.stock > 1) ? `<div class="part-card-ubic">📦 x${p.stock}</div>` : ""}
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
    card.querySelector(".part-card-img img[data-img]")?.addEventListener("click", (e) => { e.stopPropagation(); openLightbox(e.currentTarget.dataset.img); });
    list.appendChild(card);
  });

  if (visibleCount < filtered.length) {
    const moreBtn = document.createElement("button");
    moreBtn.className = "load-more";
    moreBtn.textContent = `Cargar más (${filtered.length - visibleCount} restantes)`;
    moreBtn.onclick = () => { visibleCount += PAGE_SIZE; renderParts(); };
    list.appendChild(moreBtn);
  }
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
    const stockRestante = (_salePart.stock !== undefined && _salePart.stock !== null) ? Number(_salePart.stock) : 1;
    if (stockRestante > 1) {
      _salePart.stock = stockRestante - 1;
    } else {
      const idx = parts.findIndex(p => p.id === _salePart.id);
      if (idx > -1) parts.splice(idx, 1);
    }
    closeModal("ven-modal");
    renderParts();
    updateStats();
    historicalSalesTotal += price;
    historicalCommission += Math.round(price * COMMISSION_RATE);
    pendingCommission += Math.round(price * COMMISSION_RATE);
    updateCommissionDisplay();
    saveSalesStatsCache();
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

function closeLoteModal() {
  closeModal("ven-lote-modal");
  $("lote-search").oninput = null;
  _loteCart = [];
}

let _loteCart = [];
let _loteSearchDebounce = null;

function openLoteModal() {
  _loteCart = [];
  const searchInput = $("lote-search");
  searchInput.value = "";
  $("lote-search-results").innerHTML = "";
  renderLoteCart();
  $("lote-modal").classList.add("on");
  setTimeout(() => searchInput.focus(), 100);

  searchInput.oninput = () => {
    clearTimeout(_loteSearchDebounce);
    _loteSearchDebounce = setTimeout(() => renderLoteSearchResults(searchInput.value), 200);
  };
  renderLoteSearchResults("");
}

function renderLoteSearchResults(q) {
  const results = $("lote-search-results");
  if (!results) return;
  const query = (q || "").toLowerCase();

  // Filtrar partes disponibles que NO estén ya en el carrito
  const inCartIds = new Set(_loteCart.map(item => item.part.id));
  let candidates = parts.filter(p => {
    const est = p.estado || (p.sold ? "vendida" : "disponible");
    if (est !== "disponible") return false;
    if (inCartIds.has(p.id)) return false;
    return true;
  });
  if (query) {
    candidates = candidates.filter(p => {
      const s = [p.marca, p.modelo, p.categoria, p.posicion, p.ubicacion, p.descripcion, p.codigoOem].join(" ").toLowerCase();
      return s.includes(query);
    });
  }
  if (!candidates.length) {
    results.innerHTML = `<div style="padding:10px;color:var(--t4);font-size:11px;text-align:center">${query ? "Sin resultados" : "No hay partes disponibles"}</div>`;
    return;
  }
  results.innerHTML = candidates.map(p => {
    return `<div class="lote-search-item" data-lote-pick="${p.id}" style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid var(--bdr);cursor:pointer">
      <span style="flex:1;font-size:11px">${escH(p.marca)} ${escH(p.modelo)}</span>
      <span style="font-size:9px;color:var(--t4)">${p.posicion}</span>
      <button class="lote-add-btn" style="background:var(--green-lt);border:none;border-radius:var(--r4);color:#000;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer">+Agregar</button>
    </div>`;
  }).join("");
  results.querySelectorAll("[data-lote-pick]").forEach(el => {
    const btn = el.querySelector(".lote-add-btn");
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.lotePick;
        const found = parts.find(p => String(p.id) === String(id));
        if (found) promptAddToCart(found);
      };
    }
  });
}

function promptAddToCart(part) {
  // Crear mini prompt inline para el precio
  const results = $("lote-search-results");
  const precio = prompt(`Precio para: ${part.marca} ${part.modelo}`, part.precioVenta || "");
  if (precio === null) return;
  const num = parseFloat(precio.replace(/\./g, "").replace(",", "."));
  if (!num || num <= 0) { toast("Precio inválido"); return; }

  _loteCart.push({ part, price: num });
  renderLoteCart();
  renderLoteSearchResults($("lote-search").value);
  toast(`${part.marca} ${part.modelo} — $${num.toLocaleString("es-CL")}`);
}

function removeFromCart(index) {
  _loteCart.splice(index, 1);
  renderLoteCart();
  renderLoteSearchResults($("lote-search").value);
}

function renderLoteCart() {
  const cart = $("lote-cart");
  const total = $("lote-total");
  const confirmBtn = $("lote-confirm");

  if (!_loteCart.length) {
    cart.innerHTML = `<div style="padding:12px;color:var(--t4);font-size:11px;text-align:center">Carrito vacío — buscá partes arriba y agregalas</div>`;
    total.textContent = "$0";
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = "0.4";
    return;
  }

  confirmBtn.disabled = false;
  confirmBtn.style.opacity = "1";

  const sum = _loteCart.reduce((s, item) => s + item.price, 0);
  total.textContent = "$" + Math.round(sum).toLocaleString("es-CL");

  cart.innerHTML = _loteCart.map((item, idx) => {
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid var(--bdr)">
      <span style="flex:1;font-size:11px">${escH(item.part.marca)} ${escH(item.part.modelo)}</span>
      <span style="font-size:12px;font-weight:700;color:var(--gold)">$${Math.round(item.price).toLocaleString("es-CL")}</span>
      <button class="lote-rm-btn" data-rm-idx="${idx}" style="background:none;border:none;color:var(--red-lt);cursor:pointer;font-size:14px;padding:2px" title="Quitar">✕</button>
    </div>`;
  }).join("");

  cart.querySelectorAll("[data-rm-idx]").forEach(btn => {
    btn.onclick = () => removeFromCart(parseInt(btn.dataset.rmIdx));
  });
}

async function confirmLoteSale() {
  if (!_loteCart.length) { toast("Agregá al menos una parte"); return; }

  const total = _loteCart.reduce((s, item) => s + item.price, 0);

  const btn = $("lote-confirm");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    await recordMultiSale(_loteCart, sellerName);

    const soldIds = new Set(_loteCart.map(item => item.part.id));
    for (let i = parts.length - 1; i >= 0; i--) {
      if (soldIds.has(parts[i].id)) parts.splice(i, 1);
    }

    closeModal("ven-lote-modal");
    renderParts();
    updateStats();

    historicalSalesTotal += total;
    const com = Math.round(total * COMMISSION_RATE);
    historicalCommission += com;
    pendingCommission += com;
    updateCommissionDisplay();
    saveSalesStatsCache();

    toast(`Lote vendido: ${_loteCart.length} partes por $${Math.round(total).toLocaleString("es-CL")}`);
  } catch(e) {
    toast("Error al guardar la venta múltiple");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar Venta Múltiple";
  }
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
    const com = sales.reduce((s, v) => s + (v.comision || Math.round((v.total || 0) * COMMISSION_RATE)), 0);
    $("hist-sub").textContent = `${sales.length} ventas · $${Math.round(total).toLocaleString("es-CL")} total · $${Math.round(com).toLocaleString("es-CL")} comisión`;
    list.innerHTML = sales.map((v, idx) => {
      const items = (v.items || []).map(it => `${it.marca} ${it.modelo}${it.cantidad && it.cantidad > 1 ? ` x${it.cantidad}` : ""}`).join(", ");
      const fec = v.fecha || "";
      const comision = v.comision || Math.round((v.total||0) * COMMISSION_RATE);
      return `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--bdr);align-items:flex-start" data-ven-idx="${idx}">
        <span style="font-size:9px;color:var(--t4);white-space:nowrap;min-width:50px">${fec}</span>
        <span style="font-size:11px;flex:1">${escH(items)}</span>
        <span style="font-size:12px;font-weight:700;color:var(--gold)">$${Math.round(v.total||0).toLocaleString("es-CL")}</span>
        <span style="font-size:10px;color:var(--amber-lt)">$${Math.round(comision).toLocaleString("es-CL")}</span>
        <button class="hist-del-btn" data-ven-del="${idx}" title="Eliminar venta" style="background:none;border:none;color:var(--red-lt);cursor:pointer;font-size:14px;padding:2px">✕</button>
      </div>`;
    }).join("");
    list.querySelectorAll("[data-ven-del]").forEach(btn => {
      const idx = parseInt(btn.dataset.venDel);
      const sale = sales[idx];
      if (!sale) return;
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("¿Eliminar esta venta del historial?")) return;
        btn.disabled = true; btn.textContent = "…";
        const ok = await deleteSale(sale.id);
        if (!ok) { toast("Error al eliminar"); btn.disabled = false; btn.textContent = "✕"; return; }
        const partId = (sale.items||[])[0]?.partId;
        if (partId && confirm("¿Restaurar la parte como disponible en el catálogo?")) {
          await restorePart(partId);
        }
        toast("Venta eliminada");
        openMySales();
      };
    });

    let excelBtn = $("hist-excel-btn");
    if (excelBtn) excelBtn.onclick = () => downloadSalesExcel(sales);
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red-lt);font-size:12px">Error al cargar ventas</div>';
    console.error(e);
  }
}

function downloadSalesExcel(sales) {
  if (!sales || !sales.length) { toast("Sin ventas para exportar"); return; }
  if (typeof XLSX === "undefined") { toast("Error: XLSX no disponible"); return; }
  const rows = sales.map((v, i) => ({
    "#": i + 1,
    Fecha: v.fecha || "",
    Vendedor: v.vendedor || sellerName,
    Marca: (v.items||[]).map(it => it.marca).join(", "),
    Modelo: (v.items||[]).map(it => it.modelo).join(", "),
    Total: v.total || 0,
    Comision: v.comision || Math.round((v.total||0) * COMMISSION_RATE)
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Ventas");
  XLSX.writeFile(wb, `ventas-${new Date().toISOString().slice(0,10)}.xlsx`);
  toast("Excel descargado");
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
