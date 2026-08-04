const LABCOLLECTOR_TYPES = new Set([
  'plasmids',
  'strains',
  'chemicals',
  'samples',
  'antibodies',
  'storage',
]);

export function buildLabCollectorUrl(type: string, id: string): string {
  if (!LABCOLLECTOR_TYPES.has(type) || !/^[1-9]\d*$/.test(id)) {
    throw new Error('Invalid LabCollector link');
  }
  const url = new URL(`http://bs-labcollect01.ethz.ch/moor/${type}.php`);
  url.searchParams.set('search', '1');
  url.searchParams.set('strict', 'on');
  url.searchParams.set('by_id', id);
  return url.toString();
}
