// The small script file added next to numera-crm-v3.gs in the "Numera
// Automation" Apps Script project. Reading returns a copy of the Sheet.
// Changes made in the CRM run the main script's own functions (addDeal_,
// createProject_, addPayment_, deleteDeal_, recalc_ ...), so deal numbers,
// ClickUp, Drive, logins pages, balances, commission and emails behave
// exactly as with the forms and the Approvals / Tools tabs. Every name here
// starts with crm so it cannot clash with the main script (except doPost,
// which the main script does not use).
export const TRACKER_SCRIPT_VERSION = 4

export const TRACKER_APPS_SCRIPT = String.raw`/**
 * Numera CRM connection. Version ${TRACKER_SCRIPT_VERSION}.
 * Lets the Numera CRM's Client Tracker panel read this Sheet, and make the
 * same changes as the deal form, payment form, Approvals tab and Tools tab
 * by calling numera-crm-v3.gs's own functions (it must be in this project).
 *
 * Setup (CRM → Client Tracker → Settings fills in the key and address for you):
 * 1. Paste this whole file as crm-connect.gs and save.
 * 2. Deploy → New deployment → type "Web app". Execute as: Me. Who has access: Anyone.
 * 3. Copy the Web app URL into CRM → Client Tracker → Settings.
 * 4. Pick crmSetup in the function list above and press Run once: the CRM then hears about
 *    form answers and Sheet edits within seconds.
 */
const CRM_KEY = 'PASTE-KEY-HERE';
const CRM_URL = 'PASTE-CRM-ADDRESS';
const CRM_SHEET_ID = '1vc8UsKlvhFbIpEIsg--pMzbQypiGtGhfDQVnLZ19gJ0';
const CRM_TABS = ['Deals', 'Approvals', 'Payment Log', 'Client Balances', 'Agents', 'PM Commission', 'Owner Deals', 'Commission Settings', 'Commission Payouts'];
const CRM_HEADERS = ['Deal ID', 'Payment ID', 'Pay Month', 'Month', 'Person', 'Payout ID'];
const CRM_RATES_TAB = 'Commission Settings', CRM_PAYOUTS_TAB = 'Commission Payouts';
const CRM_RATES_COLS = ['Person', 'Role', 'Rate', 'Note', 'Updated'];
const CRM_PAYOUT_COLS = ['Payout ID', 'Date', 'Person', 'Role', 'Amount', 'Statement up to', 'Note', 'Added By', 'Added At'];

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

/** Every tab as shown in the Sheet (proof is only a link: the files stay in Drive). */
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
      if (/assets/i.test(h)) continue; // Proof links stay: the files themselves stay in Drive.
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
  return { generatedAt: new Date().toISOString(), tabs: tabs, clickup: crmClickUp_(tabs.Deals), commission: crmCommissionDefaults_() };
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
  },

  /** Same as editing the Deals tab by hand: Services text, balances, commission, payment list and logins list follow. */
  editDeal: function (input, actor) {
    syncCols_();
    const deals = tab_(TAB.deals);
    const r = findRow_(deals, DEAL_COLS, String(input.dealId), 1);
    if (!r) throw new Error(input.dealId + ' is not on the Deals tab.');
    const formulas = dealFormulas_();
    const names = Object.keys(input.fields || {});
    names.forEach(function (name) {
      const c = DEAL_COLS.indexOf(name);
      if (c < 0 || formulas[name] || CRM_EDITABLE.indexOf(name) < 0) throw new Error('Cannot change ' + name + '.');
      let v = input.fields[name];
      if (name === 'Date Closed' || name === 'Marketing Start') v = crmDate_(v);
      else if (/Amount$|^Marketing Days$/.test(name)) v = v === '' || v === null ? '' : num_(v);
      else if (name === 'Phone') v = phone_(v);
      else v = String(v === null || v === undefined ? '' : v);
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = "'" + v;
      deals.getRange(r, c + 1).setValue(v);
    });
    if (!names.length) return { changed: 0 };
    refreshServices_(deals, r);
    if (names.some(function (n) { return ['Client', 'Business / Brand', 'Phone'].indexOf(n) > -1; })) {
      try { refreshLoginsIndex_(); } catch (err) { Logger.log('Logins list: ' + err.message); }
    }
    syncAdvanceDates_();
    crmAfterChange_();
    return { changed: names.length, by: actor };
  },

  /** Change a Payment Log row (date, amount, payment or refund, method, note). */
  editPayment: function (input, actor) {
    const log = tab_(TAB.log);
    const r = findRow_(log, LOG_COLS, String(input.paymentId), 1);
    if (!r) throw new Error('Payment ' + input.paymentId + ' was not found.');
    const ci = function (n) { return LOG_COLS.indexOf(n) + 1; };
    const type = String(log.getRange(r, ci('Type')).getValue());
    const refund = input.kind ? input.kind === 'Refund' : /refund/i.test(type);
    if (input.amount !== undefined) {
      const amt = Math.abs(num_(input.amount));
      if (!amt) throw new Error('Enter an amount.');
      log.getRange(r, ci('Amount')).setValue(refund ? -amt : amt);
    }
    if (input.kind) log.getRange(r, ci('Type')).setValue(refund ? 'Refund' : (/^Advance/.test(type) ? type : 'Installment'));
    if (input.date) log.getRange(r, ci('Date')).setValue(crmDate_(input.date));
    if (input.method !== undefined) log.getRange(r, ci('Method')).setValue(String(input.method || ''));
    if (input.note !== undefined) log.getRange(r, ci('Note')).setValue(String(input.note || '') + ' (edited in the CRM by ' + actor + ')');
    crmAfterChange_();
    return { paymentId: input.paymentId };
  },

  /** Remove one Payment Log row. */
  deletePayment: function (input) {
    const log = tab_(TAB.log);
    const r = findRow_(log, LOG_COLS, String(input.paymentId), 1);
    if (!r) throw new Error('Payment ' + input.paymentId + ' was not found.');
    log.deleteRow(r);
    crmAfterChange_();
    return { paymentId: input.paymentId };
  },

  /** The Tools tab's health check. */
  healthCheck: function () {
    return { lines: healthCheck_() };
  },

  /** Default commission numbers: the settings cells on Agents and PM Commission. */
  commissionDefaults: function (input) {
    const ag = tab_(TAB.agents), pm = tab_(TAB.pm);
    if (input.target !== undefined && input.target !== '') ag.getRange('B2').setValue(num_(input.target));
    if (input.rateBelow !== undefined && input.rateBelow !== '') ag.getRange('D2').setValue(num_(input.rateBelow) / 100);
    if (input.rateAbove !== undefined && input.rateAbove !== '') ag.getRange('F2').setValue(num_(input.rateAbove) / 100);
    if (input.pmRate !== undefined && input.pmRate !== '') pm.getRange('B2').setValue(num_(input.pmRate) / 100);
    return crmCommissionDefaults_();
  },

  /** One person's own rate on the Commission Settings tab (empty rate = the default). */
  personRate: function (input, actor) {
    const sh = crmTab_(CRM_RATES_TAB, CRM_RATES_COLS);
    const role = input.role === 'PM' ? 'PM' : 'Agent';
    const rows = rowsOf_(sh, CRM_RATES_COLS, 1);
    let r = 0;
    rows.forEach(function (o, i) { if (String(o.Person).trim() === String(input.name).trim() && o.Role === role) r = i + 2; });
    const rate = input.rate === '' || input.rate === null || input.rate === undefined ? '' : num_(input.rate) / 100;
    const row = [String(input.name).trim(), role, rate, String(input.note || ''), new Date()];
    if (!r) r = lastRowIn_(sh, 1) + 1;
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    sh.getRange(r, 3).setNumberFormat('0.##%');
    sh.getRange(r, 5).setNumberFormat('dd-mmm-yyyy hh:mm');
    return { person: row[0], role: role, by: actor };
  },

  /** What was actually paid to someone: a row on the Commission Payouts tab. */
  addPayout: function (input, actor) {
    const sh = crmTab_(CRM_PAYOUTS_TAB, CRM_PAYOUT_COLS);
    const amt = num_(input.amount);
    if (!amt) throw new Error('Enter the amount paid.');
    const id = nextId_('LAST_PAYOUT_NO', 'CP-', 4, colValues_(sh, CRM_PAYOUT_COLS, 'Payout ID', 1));
    const r = lastRowIn_(sh, 1) + 1;
    sh.getRange(r, 1, 1, CRM_PAYOUT_COLS.length).setValues([[id, crmDate_(input.date) || dateOnly_(new Date()), String(input.name).trim(),
      input.role === 'PM' ? 'PM' : 'Agent', amt, crmDate_(input.upTo), String(input.note || ''), actor, new Date()]]);
    sh.getRange(r, 2).setNumberFormat('dd-mmm-yyyy');
    sh.getRange(r, 5).setNumberFormat('#,##0');
    sh.getRange(r, 6).setNumberFormat('dd-mmm-yyyy');
    sh.getRange(r, 9).setNumberFormat('dd-mmm-yyyy hh:mm');
    return { payoutId: id };
  },

  deletePayout: function (input) {
    const sh = crmTab_(CRM_PAYOUTS_TAB, CRM_PAYOUT_COLS);
    const r = findRow_(sh, CRM_PAYOUT_COLS, String(input.payoutId), 1);
    if (!r) throw new Error('Payout ' + input.payoutId + ' was not found.');
    sh.deleteRow(r);
    return { payoutId: input.payoutId };
  }
};

/* Deal columns the CRM may change (formula columns are never written). */
const CRM_EDITABLE = ['Date Closed', 'Sales Agent', 'Team', 'Client', 'Business / Brand', 'Phone', 'Email', 'Country', 'Website Region',
  'Website Amount', 'Hosting Amount', 'Marketing Region', 'Marketing Days', 'Marketing Start', 'Marketing Amount', 'Other Service',
  'Other Amount', 'Notes'];

/** A tab the CRM keeps (made the first time it is needed). */
function crmTab_(name, cols) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground(NAVY).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** The default commission numbers, and who counts as a PM, read straight from the Sheet. */
function crmCommissionDefaults_() {
  const ag = tab_(TAB.agents), pm = tab_(TAB.pm);
  return {
    target: ag ? num_(ag.getRange('B2').getValue()) : 0,
    rateBelow: ag ? num_(ag.getRange('D2').getValue()) : 0,
    rateAbove: ag ? num_(ag.getRange('F2').getValue()) : 0,
    pmRate: pm ? num_(pm.getRange('B2').getValue()) : 0,
    teams: teamNames_(),
    noPmTeams: pmSkip_()
  };
}

/* ---------------- Telling the CRM about changes ---------------- */

/** Run once from the editor: the CRM then hears about form answers and edits within seconds. */
function crmSetup() {
  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'crmOnSheetChange') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('crmOnSheetChange').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('crmOnSheetChange').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('crmOnSheetChange').forSpreadsheet(ss).onChange().create();
  return 'Done: the CRM will hear about changes.';
}

/** Waits for the main script to finish its own updates, then tells the CRM (at most one call per half minute). */
function crmOnSheetChange() {
  if (!/^https:\/\//.test(CRM_URL)) return;
  const cache = CacheService.getScriptCache();
  if (cache.get('crm_notify')) return;
  cache.put('crm_notify', '1', 30);
  Utilities.sleep(15000);
  try {
    UrlFetchApp.fetch(CRM_URL.replace(/\/$/, '') + '/api/tracker/notify', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({ key: CRM_KEY }), muteHttpExceptions: true
    });
  } catch (err) { Logger.log('CRM notify: ' + err.message); }
}
`
