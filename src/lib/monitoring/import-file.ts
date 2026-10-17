/** RFC-style CSV parsing: quoted commas, escaped quotes and multiline cells. */
export function parseImportFile(text: string, csv: boolean): unknown[] {
  if (!csv) { const value = JSON.parse(text); if (!Array.isArray(value)) throw new Error('Expected a JSON array.'); return value }
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && source[i + 1] === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (quoted) throw new Error('Unclosed CSV quote.')
  row.push(cell); if (row.some(Boolean)) rows.push(row)
  const headers = rows.shift()?.map(h => h.trim().toLowerCase().replaceAll(' ', '_')) ?? []
  if (new Set(headers).size !== headers.length) throw new Error('CSV column names must be unique.')
  return rows.map((values, i) => { if (values.length !== headers.length) throw new Error(`CSV row ${i + 2} has the wrong number of columns.`); return Object.fromEntries(headers.map((h, j) => [h, values[j]])) })
}
