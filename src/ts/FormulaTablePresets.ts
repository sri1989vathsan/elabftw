/**
 * @author eLabFTW contributors
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

export type WellPlatePreset = {
  wells: number;
  rows: number;
  columns: number;
};

export const WELL_PLATE_PRESETS: WellPlatePreset[] = [
  { wells: 6, rows: 2, columns: 3 },
  { wells: 12, rows: 3, columns: 4 },
  { wells: 24, rows: 4, columns: 6 },
  { wells: 48, rows: 6, columns: 8 },
  { wells: 96, rows: 8, columns: 12 },
  { wells: 384, rows: 16, columns: 24 },
];

export function createFormulaTable(rows = 5, columns = 5): string {
  const tableRows = Array.from({ length: rows }, () => {
    const cells = Array.from({ length: columns }, () => '<td>&nbsp;</td>').join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table style="border-collapse: collapse; width: 100%;"><tbody>${tableRows}</tbody></table><p></p>`;
}

export function createWellPlateTable(preset: WellPlatePreset): string {
  const columnHeaders = Array.from(
    { length: preset.columns },
    (_, index) => `<th>${index + 1}</th>`,
  ).join('');
  const plateRows = Array.from({ length: preset.rows }, (_, rowIndex) => {
    const rowLabel = String.fromCharCode(65 + rowIndex);
    const wells = Array.from(
      { length: preset.columns },
      () => '<td>&nbsp;</td>',
    ).join('');
    return `<tr><th>${rowLabel}</th>${wells}</tr>`;
  }).join('');

  return `<table data-well-plate="${preset.wells}" style="border-collapse: collapse; width: 100%;"><caption>${preset.wells}-well plate</caption><tbody><tr><th>&nbsp;</th>${columnHeaders}</tr>${plateRows}</tbody></table><p></p>`;
}
