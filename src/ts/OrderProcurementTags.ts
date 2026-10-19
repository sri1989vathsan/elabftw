export interface ProcurementTags {
  procurement_id: string | null;
  order_number: string | null;
  order_date: string | null;
}

/** Count files, not distinct IDs: each confirmation retains its own provenance. */
export function orderProcurementGroups(order: ProcurementTags & {
  uploads: (ProcurementTags & { id: number; real_name: string })[];
}): (ProcurementTags & { source: string | null; key: string })[] {
  const confirmations = order.uploads.filter(upload => !!upload.procurement_id)
    .sort((a, b) => a.id - b.id);
  if (confirmations.length === 0) return [{ ...order, source: null, key: 'legacy' }];
  return confirmations.map(upload => ({
    procurement_id: upload.procurement_id,
    order_number: upload.order_number,
    order_date: upload.order_date,
    source: confirmations.length > 1 ? upload.real_name : null,
    key: String(upload.id),
  }));
}
