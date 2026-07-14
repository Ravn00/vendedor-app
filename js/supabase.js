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
  const old = { estado: part.estado, stock: part.stock, fechaVenta: part.fechaVenta };

  const stockActual = (part.stock !== undefined && part.stock !== null) ? Number(part.stock) : 1;

  // Conditional PATCH: fail if stock already decremented or part already sold (prevents double-sale)
  const cond = stockActual > 1
    ? `&data->>stock=eq.${encodeURIComponent(String(stockActual))}`
    : `&data->>estado=neq.${encodeURIComponent("vendida")}`;

  if (stockActual > 1) {
    part.stock = stockActual - 1;
  } else {
    part.estado = "vendida";
    part.fechaVenta = now;
  }

  const resUpdate = await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(part.id)}${cond}`);
  if (!resUpdate) {
    Object.assign(part, old);
    throw new Error("La parte ya fue vendida o su stock cambió");
  }

  const venta = {
    id: ventaId, clienteId: null, clienteNombre: "Venta directa",
    items: [{ partId: part.id, marca: part.marca, modelo: part.modelo, precio: price, cantidad: 1 }],
    total: price, comision: Math.round(price * 0.1), vendedor, fecha: now, notas: ""
  };

  if (!await apiProxy("ventas", "POST", { id: ventaId, data: venta })) {
    Object.assign(part, old);
    await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(part.id)}`);
    throw new Error("Error al registrar la venta");
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

async function deleteSale(saleId) {
  return !!(await apiProxy("ventas", "DELETE", null, `?id=eq.${encodeURIComponent(saleId)}`));
}

async function restorePart(partId) {
  const part = parts.find(p => p.id === partId);
  if (!part) return false;
  const old = { estado: part.estado, fechaVenta: part.fechaVenta };
  part.estado = "disponible";
  part.fechaVenta = "";
  const ok = await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(partId)}`);
  if (!ok) { Object.assign(part, old); return false; }
  await sbLogAudit(partId, "update", { action: "restored_from_sale_deletion" });
  return true;
}

async function recordMultiSale(cartItems, vendedor) {
  const now = new Date().toLocaleString("es-CL");
  const ventaId = "ven-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
  const total = cartItems.reduce((s, item) => s + item.price, 0);

  const items = cartItems.map(item => ({
    partId: item.part.id,
    marca: item.part.marca,
    modelo: item.part.modelo,
    precio: item.price,
    cantidad: 1
  }));

  const venta = {
    id: ventaId, clienteId: null, clienteNombre: "Venta directa",
    items,
    total,
    comision: Math.round(total * 0.1),
    vendedor,
    fecha: now,
    notas: `Venta múltiple: ${cartItems.length} partes`
  };

  // Actualizar cada parte a "vendida"
  const updated = [];
  try {
    for (const item of cartItems) {
      const part = item.part;
      const old = { estado: part.estado, stock: part.stock, fechaVenta: part.fechaVenta };
      part.estado = "vendida";
      part.fechaVenta = now;

      const ok = await apiProxy("partes", "PATCH", { data: part }, `?id=eq.${encodeURIComponent(part.id)}&data->>estado=eq.disponible`);
      if (!ok) {
        // Rollback las que ya se actualizaron
        Object.assign(part, old);
        for (const done of updated) {
          Object.assign(done.part, done.old);
          await apiProxy("partes", "PATCH", { data: done.part }, `?id=eq.${encodeURIComponent(done.part.id)}`);
        }
        throw new Error(`"${part.marca} ${part.modelo}" ya no está disponible`);
      }
      updated.push({ part, old });
    }

    // Crear el registro de venta
    if (!await apiProxy("ventas", "POST", { id: ventaId, data: venta })) {
      // Rollback todas las partes
      for (const done of updated) {
        Object.assign(done.part, done.old);
        await apiProxy("partes", "PATCH", { data: done.part }, `?id=eq.${encodeURIComponent(done.part.id)}`);
      }
      throw new Error("Error al registrar la venta múltiple");
    }

    // Audit logs
    for (const item of cartItems) {
      await sbLogAudit(item.part.id, "sale", { vendedor, price: item.price, ventaId });
    }

    return venta;
  } catch(e) {
    throw e;
  }
}

async function loadMySales(vendedor) {
  const data = await sbFetchAll(`/rest/v1/ventas?select=*&order=created_at.desc`);
  if (!Array.isArray(data)) return [];
  return data
    .map(d => ({ id: d.id, ...(d.data || {}), created_at: d.created_at }))
    .filter(v => v.vendedor === vendedor)
    .slice(0, 50);
}
