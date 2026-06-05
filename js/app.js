let authed = false;
let searchFilter = "";

async function init() {
  await loadSellerConfig();
  $("pw-btn").onclick = tryLogin;
  $("pw-input").onkeydown = e => { if (e.key === "Enter") tryLogin(); };
  let searchDebounce; $("ven-search").oninput = e => { searchFilter = e.target.value; clearTimeout(searchDebounce); searchDebounce = setTimeout(renderParts, 250); };
  $("ven-confirm").onclick = confirmSale;
  $("ven-cancel").onclick = () => closeModal("ven-modal");
  $("refresh-btn").onclick = () => { loadAvailableParts().then(() => { renderParts(); updateStats(); toast("Actualizado"); }); };
}

function tryLogin() {
  const pin = $("pw-input").value.trim();
  if (pin === sellerPin) {
    authed = true;
    sellerName = pin === "1234" ? "Vendedor" : `Vendedor ${pin}`;
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
    if (est !== "disponible") return false;
    if (q && !(p.marca||"").toLowerCase().includes(q) && !(p.modelo||"").toLowerCase().includes(q) && !(p.categoria||"").toLowerCase().includes(q)) return false;
    return true;
  }).reverse();

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${q ? "Sin resultados" : "No hay partes disponibles"}</div>`;
    return;
  }

  filtered.forEach(p => {
    const imgSrc = p.preview || p.previewFull || "";
    const card = document.createElement("div"); card.className = "part-card";
    card.innerHTML = `<div class="part-card-img">${imgSrc ? `<img src="${escH(imgSrc)}">` : `<div class="part-card-noimg">📦</div>`}</div>
      <div class="part-card-body">
        <div class="part-card-title">${escH(p.marca)} ${escH(p.modelo)}</div>
        <div class="part-card-meta">${escH(p.años)} · ${escH(p.posicion)} · ${escH(p.categoria)}</div>
        ${p.precioVenta ? `<div class="part-card-price">$${Number(p.precioVenta).toLocaleString("es-CL")}</div>` : ""}
        ${p.ubicacion ? `<div class="part-card-ubic">📍 ${escH(p.ubicacion)}</div>` : ""}
      </div>`;
    card.onclick = () => openSaleModal(p);
    list.appendChild(card);
  });
}

let _salePart = null;

function openSaleModal(part) {
  _salePart = part;
  $("ven-title").textContent = `${part.marca} ${part.modelo}`;
  $("ven-detail").textContent = `${part.años} · ${part.posicion} · ${part.categoria}`;
  $("ven-price").value = part.precioVenta || "";
  $("ven-price").focus();
  $("ven-modal").classList.add("on");
}

async function confirmSale() {
  if (!_salePart) return;
  const price = parseFloat($("ven-price").value);
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
  }
  btn.disabled = false; btn.textContent = "Confirmar Venta";
}

function updateStats() {
  const disponibles = parts.filter(p => (p.estado||(p.sold?"vendida":"disponible"))==="disponible").length;
  $("stat-disponibles").textContent = disponibles;
}

function closeModal(id) { $(id).classList.remove("on"); }

function toast(msg) {
  const el = $("toast");
  $("toast-msg").textContent = msg;
  el.classList.add("on");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3000);
}

document.addEventListener("DOMContentLoaded", init);
