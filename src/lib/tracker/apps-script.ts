// The small script file added next to numera-crm-v3.gs in the "Numera
// Automation" Apps Script project. It only reads: it never changes the
// Sheet, ClickUp or Drive. Every name starts with crm so it cannot clash with
// the main script (except doPost, which the main script does not use).
export const TRACKER_SCRIPT_VERSION = 1

export const TRACKER_APPS_SCRIPT = String.raw`/**
 * Numera CRM connection (read-only). Version ${TRACKER_SCRIPT_VERSION}.
 * Lets the Numera CRM's Client Tracker panel read this Sheet.
 * It never changes the Sheet, ClickUp or Drive.
 *
 * Setup:
 * 1. Paste the key from CRM → Client Tracker → Settings between the quotes below. Save.
 * 2. Deploy → New deployment → type "Web app". Execute as: Me. Who has access: Anyone.
 * 3. Copy the Web app URL into CRM → Client Tracker → Settings.
 */
const CRM_KEY = 'PASTE-KEY-HERE';
const CRM_SHEET_ID = '1vc8UsKlvhFbIpEIsg--pMzbQypiGtGhfDQVnLZ19gJ0';
const CRM_TABS = ['Deals', 'Approvals', 'Payment Log', 'Client Balances', 'Agents', 'PM Commission', 'Owner Deals'];
const CRM_HEADERS = ['Deal ID', 'Payment ID', 'Pay Month', 'Month'];

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return crmReply_({ ok: false, error: 'bad_request' }); }
  if (!crmKeyMatches_(body.key)) return crmReply_({ ok: false, error: 'bad_key' });
  try {
    if (body.action === 'ping') return crmReply_({ ok: true, version: ${TRACKER_SCRIPT_VERSION} });
    if (body.action === 'snapshot') return crmReply_({ ok: true, version: ${TRACKER_SCRIPT_VERSION}, snapshot: crmSnapshot_() });
    return crmReply_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return crmReply_({ ok: false, error: 'script_error', message: String(err && err.message || err).slice(0, 300) });
  }
}

function crmReply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function crmKeyMatches_(given) {
  if (!CRM_KEY || CRM_KEY === 'PASTE-KEY-HERE' || typeof given !== 'string' || given.length !== CRM_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < CRM_KEY.length; i++) diff |= CRM_KEY.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** Every tab as shown in the Sheet. Payment proof links are left out. */
function crmSnapshot_() {
  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  const tabs = {};
  CRM_TABS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const grid = sheet.getDataRange().getDisplayValues();
    let headerRow = -1;
    for (let r = 0; r < Math.min(grid.length, 15); r++) if (CRM_HEADERS.indexOf(String(grid[r][0]).trim()) > -1) { headerRow = r; break; }
    if (headerRow < 0) return;
    const header = grid[headerRow];
    const keep = [];
    for (let c = 0; c < header.length; c++) {
      const h = String(header[c]).trim();
      if (!h) break; // Side tables to the right are left out.
      if (/proof|assets/i.test(h)) continue;
      keep.push(c);
    }
    const notes = grid.slice(0, headerRow).map(function (row) { return row.filter(String).join('  '); }).filter(String);
    tabs[name] = {
      headers: keep.map(function (c) { return String(header[c]).trim(); }),
      rows: grid.slice(headerRow + 1).filter(function (row) { return keep.some(function (c) { return String(row[c]).trim(); }); })
        .map(function (row) { return keep.map(function (c) { return row[c]; }); }),
      notes: notes,
    };
  });
  return { generatedAt: new Date().toISOString(), tabs: tabs, clickup: crmClickUp_(tabs.Deals) };
}

/** Project status and subtask progress per team tag, from ClickUp (read-only, cached 10 minutes). */
function crmClickUp_(deals) {
  const out = {};
  if (!deals) return out;
  const col = deals.headers.indexOf('ClickUp Project');
  if (col < 0) return out;
  const props = PropertiesService.getScriptProperties().getProperties();
  let token = '';
  Object.keys(props).forEach(function (k) { if (!token && /^pk_/.test(String(props[k]))) token = props[k]; });
  if (!token) return out;
  const cache = CacheService.getScriptCache();
  const ids = [];
  deals.rows.forEach(function (row) {
    const m = String(row[col] || '').match(/\/t\/(?:\d+\/)?([a-z0-9]+)/i);
    if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
  });
  const missing = [];
  ids.forEach(function (id) { const hit = cache.get('crm_cu_' + id); if (hit) out[id] = JSON.parse(hit); else missing.push(id); });
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const replies = UrlFetchApp.fetchAll(batch.map(function (id) {
      return { url: 'https://api.clickup.com/api/v2/task/' + id + '?include_subtasks=true', headers: { Authorization: token }, muteHttpExceptions: true };
    }));
    replies.forEach(function (res, j) {
      if (res.getResponseCode() !== 200) return;
      const task = JSON.parse(res.getContentText());
      const teams = {};
      (task.subtasks || []).forEach(function (s) {
        const tag = ((s.tags || [])[0] || {}).name || 'other';
        if (!teams[tag]) teams[tag] = [0, 0];
        teams[tag][1]++;
        const st = s.status || {};
        if (st.type === 'closed' || st.type === 'done' || /closed|complete|done/i.test(String(st.status || ''))) teams[tag][0]++;
      });
      const summary = { status: (task.status && task.status.status) || '', teams: teams };
      out[batch[j]] = summary;
      cache.put('crm_cu_' + batch[j], JSON.stringify(summary), 600);
    });
  }
  return out;
}
`
