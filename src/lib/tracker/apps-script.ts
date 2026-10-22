// The small script file added next to numera-crm-v3.gs in the "Numera
// Automation" Apps Script project. Reading returns a copy of the Sheet.
// Changes made in the CRM run the main script's own functions (addDeal_,
// createProject_, addPayment_, deleteDeal_, recalc_ ...), so deal numbers,
// ClickUp, Drive, logins pages, balances, commission and emails behave
// exactly as with the forms and the Approvals / Tools tabs. Every name here
// starts with crm so it cannot clash with the main script (except doPost,
// which the main script does not use).
export const TRACKER_SCRIPT_VERSION = 2

export const TRACKER_APPS_SCRIPT = String.raw`/**
 * Numera CRM connection. Version ${TRACKER_SCRIPT_VERSION}.
 * Lets the Numera CRM's Client Tracker panel read this Sheet, and make the
 * same changes as the deal form, payment form, Approvals tab and Tools tab
 * by calling numera-crm-v3.gs's own functions (it must be in this project).
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
    if (body.action === 'options') return crmReply_({ ok: true, version: ${TRACKER_SCRIPT_VERSION}, options: crmOptions_() });
    const act = CRM_ACTIONS[body.action];
    if (!act) return crmReply_({ ok: false, error: 'unknown_action' });
    const result = act(body.input || {}, String(body.actor || 'CRM').slice(0, 60));
    SpreadsheetApp.flush();
    return crmReply_({ ok: true, version: ${TRACKER_SCRIPT_VERSION}, result: result, snapshot: crmSnapshot_() });
  } catch (err) {
    return crmReply_({ ok: false, error: 'script_error', message: String(err && err.message || err).slice(0, 500) });
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
  let token = typeof CONFIG !== 'undefined' && /^pk_/.test(String(CONFIG.CLICKUP_TOKEN || '')) ? CONFIG.CLICKUP_TOKEN : '';
  const props = PropertiesService.getScriptProperties().getProperties();
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

/* ---------------- Changes from the CRM ---------------- */

/** Choices for the CRM's forms: the deal form's own options plus the main script's lists. */
function crmOptions_() {
  const form = {};
  FormApp.openById(CONFIG.DEAL_FORM_ID).getItems().forEach(function (it) {
    const t = it.getType();
    let ch = null;
    if (t === FormApp.ItemType.MULTIPLE_CHOICE) ch = it.asMultipleChoiceItem().getChoices();
    else if (t === FormApp.ItemType.LIST) ch = it.asListItem().getChoices();
    else if (t === FormApp.ItemType.CHECKBOX) ch = it.asCheckboxItem().getChoices();
    if (ch) form[it.getTitle()] = ch.map(function (c) { return c.getValue(); });
  });
  return { form: form, lists: LISTS, questions: Q };
}

function crmDate_(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
}
function crmApprovalRow_(dealId) {
  const appr = tab_(TAB.approvals);
  const r = findRow_(appr, APPR_COLS, dealId, 1);
  if (!r) throw new Error(dealId + ' is not on the Approvals tab.');
  return { appr: appr, r: r };
}
function crmAfterChange_() {
  SpreadsheetApp.flush();
  recalc_();
  try { refreshPaymentList_(); } catch (err) { Logger.log('Payment list: ' + err.message); }
  try { updateAgents_(); } catch (err) { Logger.log('Agents: ' + err.message); }
}

const CRM_ACTIONS = {
  /** Same as a Closed Deal form answer: the answers are read by the main script's own dealFromRaw_. */
  addDeal: function (input, actor) {
    syncCols_();
    const titles = [], values = [];
    Object.keys(input.answers || {}).forEach(function (title) {
      const v = input.answers[title];
      titles.push(title);
      values.push(/date/i.test(title) ? crmDate_(v) : v);
    });
    titles.push('Timestamp'); values.push(new Date());
    const h = {};
    titles.forEach(function (t, i) { h[t] = i + 1; });
    const d = dealFromRaw_(values, h);
    if (!d.client || !d.agent) throw new Error('Client name and sales agent are required.');
    d.notes = (d.notes ? d.notes + ' | ' : '') + 'Added in the CRM by ' + actor;
    const dup = findDuplicate_(d);
    if (dup) d.notes = 'POSSIBLE DUPLICATE of ' + dup + ' - advance not added. If it is a mistake, delete it; if it is a ' +
      'real new deal, add the advance as a payment.' + ' | ' + d.notes;
    addDeal_(d);
    if (d.advance > 0 && !dup) {
      addPayment_({ date: d.closed, dealId: d.dealId, client: d.client, amount: d.advance, by: d.agent, type: 'Advance',
        proof: '', note: 'From the CRM', source: 'CRM', addedBy: actor });
    }
    crmAfterChange_();
    try { dealEmail_(d, dup); } catch (err) { Logger.log('Deal email: ' + err.message); }
    return { dealId: d.dealId, clientId: d.clientId, duplicateOf: dup || '' };
  },

  /** Same as ticking Approved: Drive folder, ClickUp project and subtasks, logins page. */
  approve: function (input) {
    const a = crmApprovalRow_(String(input.dealId));
    const ci = function (n) { return APPR_COLS.indexOf(n) + 1; };
    a.appr.getRange(a.r, ci('Approved')).setValue(true);
    SpreadsheetApp.flush();
    createProject_(a.appr, a.r);
    const link = String(a.appr.getRange(a.r, ci('ClickUp Project')).getValue());
    if (/^ERROR/.test(link)) throw new Error(link.replace(/^ERROR:\s*/, ''));
    return { clickup: link, drive: String(a.appr.getRange(a.r, ci('Drive Folder')).getValue()) };
  },

  /** Same as changing Client Status (and offboard date / reason) on the Approvals tab. */
  status: function (input) {
    const a = crmApprovalRow_(String(input.dealId));
    const ci = function (n) { return APPR_COLS.indexOf(n) + 1; };
    if (LISTS.clientStatus.indexOf(input.status) < 0) throw new Error('Unknown client status.');
    a.appr.getRange(a.r, ci('Client Status')).setValue(input.status);
    if (input.status === 'Offboarded') {
      a.appr.getRange(a.r, ci('Offboard Date')).setValue(crmDate_(input.offboardDate) || dateOnly_(new Date()));
      if (input.offboardReason !== undefined) a.appr.getRange(a.r, ci('Offboard Reason')).setValue(String(input.offboardReason || ''));
    }
    try { syncClickUpStatus_(a.appr, a.r); } catch (err) { Logger.log('ClickUp status: ' + err.message); }
    crmAfterChange_();
    return { status: input.status };
  },

  /** Same as a Payment Received form answer. */
  payment: function (input, actor) {
    syncCols_();
    const dealId = normDealId_(String(input.dealId || ''));
    const deals = tab_(TAB.deals);
    const dr = dealId ? findRow_(deals, DEAL_COLS, dealId, 1) : 0;
    if (!dr) throw new Error('Deal ' + input.dealId + ' was not found.');
    const refund = input.kind === 'Refund';
    const amt = Math.abs(num_(input.amount)) * (refund ? -1 : 1);
    if (!amt) throw new Error('Enter an amount.');
    const pid = addPayment_({
      date: crmDate_(input.date) || dateOnly_(new Date()), dealId: dealId, client: deals.getRange(dr, DEAL_COLS.indexOf('Client') + 1).getValue(),
      amount: amt, by: 'Company', type: refund ? 'Refund' : 'Installment', method: String(input.method || ''), proof: '',
      note: String(input.note || ''), source: 'CRM', addedBy: actor
    });
    crmAfterChange_();
    return { paymentId: pid };
  },

  /** Payout columns on Agents / PM Commission (the yellow cells). */
  payout: function (input) {
    const sh = tab_(input.tab === 'pm' ? TAB.pm : TAB.agents);
    const m = /^(\d{4})-(\d{2})$/.exec(String(input.month || ''));
    if (!sh || !m) throw new Error('Pay month not found.');
    const last = lastRowIn_(sh, 1);
    const rows = last > AG_HEAD ? sh.getRange(AG_HEAD + 1, 1, last - AG_HEAD, 2).getValues() : [];
    let r = 0;
    rows.forEach(function (x, i) {
      if (x[0] instanceof Date && x[0].getFullYear() === Number(m[1]) && x[0].getMonth() === Number(m[2]) - 1 && String(x[1]).trim() === String(input.name).trim()) r = AG_HEAD + 1 + i;
    });
    if (!r) throw new Error('No ' + input.month + ' row for ' + input.name + '.');
    if (input.status !== undefined) {
      if (input.status && LISTS.payout.indexOf(input.status) < 0) throw new Error('Unknown payout status.');
      sh.getRange(r, 11).setValue(input.status || '');
    }
    if (input.paidOn !== undefined) sh.getRange(r, 12).setValue(crmDate_(input.paidOn));
    if (input.amountPaid !== undefined) sh.getRange(r, 13).setValue(input.amountPaid === '' || input.amountPaid === null ? '' : num_(input.amountPaid));
    if (input.note !== undefined) sh.getRange(r, 14).setValue(String(input.note || ''));
    return { row: r };
  },

  /** Same as the Tools tab's Delete deal (the CRM asks for confirmation first). */
  deleteDeal: function (input) {
    const id = String(input.dealId || '');
    let msg = deleteDeal_(id);
    if (/tick the box again/.test(msg)) msg = deleteDeal_(id); // approved deal: the CRM already confirmed
    crmAfterChange_();
    return { message: msg };
  }
};
`
