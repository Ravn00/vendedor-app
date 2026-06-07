async function loadAvailableParts() {
  const data = await sbFetchAll("/rest/v1/partes?select=id,data,created_at&order=created_at.desc");
  if (!data || !Array.isArray(data)) return;
  parts = data.map(d => {
    const p = { id: d.id, ...(d.data || {}), created_at: d.created_at };
    if (p.photoUrl) { p.preview = p.photoUrl; p.previewFull = p.photoUrl; }
    else { if (p.preview && !p.previewFull) p.previewFull = p.preview; if (!p.preview && p.previewFull) p.preview = p.previewFull; }
    if (!p.photos || !Array.isArray(p.photos)) { p.photos = p.photoUrl ? [p.photoUrl] : (p.preview ? [p.preview] : []); }
    return p;
  });
}

async function recordSale(part, price, vendedor) {
  const now = new Date().toLocaleString("es-CL");
  const ventaId = "ven-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
  const old = { estado: part.estado, fechaVenta: part.fechaVenta };

  const venta = {
    id: ventaId,
    clienteId: null,
    clienteNombre: "Venta directa",
    items: [{ partId: part.id, marca: part.marca, modelo: part.modelo, precio: price, cantidad: 1 }],
    total: price,
    comision: Math.round(price * 0.1),
    vendedor,
    fecha: now,
    notas: ""
  };

  const ventaRes = await apiProxy("ventas", "POST", { id: ventaId, data: venta });
  if (!ventaRes) throw new Error("Error al registrar la venta");

  const stockActual = (part.stock !== undefined && part.stock !== null) ? Number(part.stock) : 1;
  if (stockActual > 1) {
    part.stock = stockActual - 1;
  } else {
    part.estado = "vendida";
    part.fechaVenta = now;
  }
  const res1 = await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(part.id)}`);
  if (!res1) {
    Object.assign(part, old);
    await apiProxy("ventas", "DELETE", null, `?id=eq.${encodeURIComponent(ventaId)}`);
    throw new Error("Error al actualizar la parte");
  }

  await sbLogAudit(part.id, "sale", { vendedor, price, ventaId });
  return venta;
}

async function reservePart(part, nombre, telefono, nota) {
  const old = { estado: part.estado, fechaReserva: part.fechaReserva, reservadoPor: part.reservadoPor, telefonoCliente: part.telefonoCliente, notaReserva: part.notaReserva };
  part.estado = "reservada";
  part.fechaReserva = new Date().toLocaleString("es-CL");
  part.reservadoPor = nombre;
  part.telefonoCliente = telefono;
  part.notaReserva = nota || "";
  const res = await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(part.id)}`);
  if (!res) { Object.assign(part, old); return false; }
  await sbLogAudit(part.id, "reserve", { nombre, telefono });
  return true;
}

async function releaseReservation(part) {
  const old = { estado: part.estado, fechaReserva: part.fechaReserva, reservadoPor: part.reservadoPor, telefonoCliente: part.telefonoCliente, notaReserva: part.notaReserva };
  part.estado = "disponible";
  part.fechaReserva = "";
  part.reservadoPor = "";
  part.telefonoCliente = "";
  part.notaReserva = "";
  const res = await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(part.id)}`);
  if (!res) { Object.assign(part, old); return false; }
  await sbLogAudit(part.id, "release", {});
  return true;
}

async function loadPartHistory(partId) {
  const data = await sbFetch(`/rest/v1/partes_log?select=*&part_id=eq.${encodeURIComponent(partId)}&order=timestamp.desc&limit=50`);
  return Array.isArray(data) ? data : [];
}

async function loadMySales(vendedor) {
  const data = await sbFetchAll(`/rest/v1/ventas?select=*&order=created_at.desc`);
  if (!Array.isArray(data)) return [];
  return data
    .map(d => ({ id: d.id, ...(d.data || {}), created_at: d.created_at }))
    .filter(v => v.vendedor === vendedor)
    .slice(0, 50);
}
