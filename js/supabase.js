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

  part.estado = "vendida";
  part.fechaVenta = now;
  part.sold = true;

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

  const res1 = await sbFetch(`/rest/v1/partes?id=eq.${encodeURIComponent(part.id)}`, "PATCH", { data: part });
  if (!res1) throw new Error("Error al actualizar parte");

  const existingVenta = await sbFetch(`/rest/v1/ventas?id=eq.${encodeURIComponent(ventaId)}&select=id`);
  if (existingVenta && existingVenta.length > 0) {
    await sbFetch(`/rest/v1/ventas?id=eq.${encodeURIComponent(ventaId)}`, "PATCH", { id: ventaId, data: venta });
  } else {
    await sbFetch("/rest/v1/ventas", "POST", { id: ventaId, data: venta });
  }

  await sbLogAudit(part.id, "sale", { vendedor, price, ventaId });

  return venta;
}
