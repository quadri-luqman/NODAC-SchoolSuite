/* Noble Minds School Accounting System - LOCAL EDITION data engine (v1.0)
   Replaces the cloud database. ALL data is stored in this browser's IndexedDB on this device only.
   Same rules as the cloud edition: integer kobo, append-only ledgers, server-style receipt numbers, approvals. */
(function (root) {
'use strict';
const DB_NAME = 'nm-school-accounting', STORE = 'kv', KEY = 'db';
const TABLES = ['schools','profiles','classes','terms','students','fee_schedule','invoices','payments','payroll_settings','staff','salary_structure','loans','payroll_lines','payroll_payments','expenses','expense_payments','items','stock_purchases','stock_sales'];
const CATS = ['School Fees','PTA Levy','Examination Fee','Lesson Fee','Uniforms','Sportswear','Textbooks','Other Income'];
const EXPCATS = ['Utilities','Rent and Rates','Stationery and Supplies','Repairs and Maintenance','Transport and Fuel','Administration','Bank Charges','Staff Welfare','Marketing','Training and Development'];
const STOCKCATS = ['Uniform','Textbook','Sportswear'];
const METHODS = ['Cash','Bank Transfer','POS','Cheque'];
const LOCAL_USER = { id: 'local-user', email: 'owner@this-browser' };

/* ---------------- storage ---------------- */
const idbOpen = () => new Promise((res, rej) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbGet(){ const d = await idbOpen(); return new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => { d.close(); res(r.result); }; r.onerror = () => rej(r.error); }); }
async function idbPut(v){ const d = await idbOpen(); return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, KEY); t.oncomplete = () => { d.close(); res(); }; t.onerror = () => rej(t.error); }); }
const fresh = () => ({ version: 1, created: new Date().toISOString(), meta: { lastTs: '', lastBackup: null }, counters: {}, t: Object.fromEntries(TABLES.map(x => [x, []])) });
const norm = db => { if(!db) return fresh(); for(const t of TABLES) db.t[t] = db.t[t] || []; db.counters = db.counters || {}; db.meta = db.meta || { lastTs: '', lastBackup: null }; return db; };
let chain = Promise.resolve();
const lock = fn => (typeof navigator !== 'undefined' && navigator.locks) ? navigator.locks.request('nm-db', fn) : (() => { const p = chain.then(fn); chain = p.catch(() => {}); return p; })();
let bc = null, listeners = [];
try { if(typeof BroadcastChannel !== 'undefined'){ bc = new BroadcastChannel('nm-db'); bc.onmessage = () => listeners.forEach(f => f()); } } catch(e){}
const notify = () => { try { bc && bc.postMessage('changed'); } catch(e){} };
const read = async () => norm(await idbGet());
const mutate = fn => lock(async () => { const db = norm(await idbGet()); const out = fn(db); await idbPut(db); notify(); return out; });   // throws => nothing saved (rollback)

/* ---------------- helpers ---------------- */
const bad = m => { throw new Error(m); };
const uid = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const ts = db => { let n = new Date().toISOString(); if(db.meta.lastTs && n <= db.meta.lastTs) n = new Date(new Date(db.meta.lastTs).getTime() + 1).toISOString(); db.meta.lastTs = n; return n; };
const serial = (db, kind, year) => { const k = kind + '|' + year; db.counters[k] = (db.counters[k] || 0) + 1; return db.counters[k]; };
const pad = (n, w) => String(n).padStart(w, '0');
const yr = d => parseInt(String(d).slice(0, 4), 10);
const sum = (a, f) => a.reduce((x, y) => x + Number(f(y)), 0);
const rhu = (num, den) => Math.floor((2 * num + den) / (2 * den));            // round half up, non-negative
const bp = x => Math.round(Number(x) * 10000);
const today = () => new Date().toISOString().slice(0, 10);
const mstart = d => String(d).slice(0, 7) + '-01';
const mend = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const school = db => db.t.schools[0];
const sid = db => { if(!school(db)) bad('Create the school first'); return school(db).id; };
const me = db => db.t.profiles[0];
const stuOf = (db, id) => db.t.students.find(s => s.id === id && s.school_id === sid(db));
const inArr = (v, arr, label) => { if(!arr.includes(v)) bad('Invalid ' + label + ': ' + v); };

/* ---------------- views (same definitions as the cloud schema) ---------------- */
const V = {
  student_balances: db => db.t.students.map(s => {
    const billed = sum(db.t.invoices.filter(i => i.student_id === s.id), i => i.net_kobo) + sum(db.t.stock_sales.filter(x => x.student_id === s.id && x.pay_mode === 'Student Account'), x => x.total_kobo);
    const ps = db.t.payments.filter(p => p.student_id === s.id), paid = sum(ps, p => p.signed_kobo);
    return { student_id: s.id, school_id: s.school_id, admission_no: s.admission_no, surname: s.surname, first_name: s.first_name, class_name: s.class_name, status: s.status,
             billed_kobo: billed, paid_kobo: paid, outstanding_kobo: billed - paid, advance_kobo: sum(ps, p => p.advance_kobo) };
  }),
  payment_list: db => db.t.payments.map(p => {
    const s = db.t.students.find(x => x.id === p.student_id) || {};
    const status = p.entry_type === 'payment' ? (db.t.payments.some(r => r.original_id === p.id && r.entry_type === 'reversal') ? 'CANCELLED' : 'VALID') : p.entry_type === 'reversal' ? 'REVERSAL' : 'REFUND';
    return { ...p, status, admission_no: s.admission_no, surname: s.surname, first_name: s.first_name, class_name: s.class_name };
  }),
  payroll_list: db => db.t.payroll_lines.map(l => {
    const s = db.t.staff.find(x => x.id === l.staff_id) || {}, pay = db.t.payroll_payments.find(x => x.line_id === l.id);
    return { ...l, staff_no: s.staff_no, surname: s.surname, first_name: s.first_name, position: s.position, bank: s.bank, account_no: s.account_no, email: s.email || '', paid_date: pay ? pay.paid_date : null, paid: !!pay };
  }),
  staff_loan_balances: db => db.t.staff.map(s => {
    const ls = db.t.loans.filter(l => l.staff_id === s.id), issued = sum(ls, l => l.amount_kobo), repaid = sum(db.t.payroll_lines.filter(l => l.staff_id === s.id && l.status === 'approved'), l => l.loan_kobo);
    return { staff_id: s.id, school_id: s.school_id, staff_no: s.staff_no, surname: s.surname, first_name: s.first_name, issued_kobo: issued, repaid_kobo: repaid, outstanding_kobo: issued - repaid,
             active_instalment_kobo: sum(ls.filter(l => l.status === 'active'), l => l.monthly_kobo) };
  }),
  item_stock: db => db.t.items.map(i => {
    const ps = db.t.stock_purchases.filter(p => p.item_id === i.id), ss = db.t.stock_sales.filter(s => s.item_id === i.id);
    const pq = sum(ps, p => p.signed_qty), pc = sum(ps, p => p.signed_cost_kobo), sq = sum(ss, s => s.signed_qty), cogs = sum(ss, s => s.cogs_kobo);
    return { item_id: i.id, school_id: i.school_id, code: i.code, name: i.name, category: i.category, price_kobo: i.price_kobo, reorder_level: i.reorder_level, qty_purchased: pq, qty_sold: sq, balance: pq - sq,
             purchase_cost_kobo: pc, cogs_kobo: cogs, stock_value_kobo: pc - cogs, sales_kobo: sum(ss, s => s.total_kobo), reorder: pq - sq <= i.reorder_level };
  })
};
const balance = (db, id) => V.student_balances(db).find(b => b.student_id === id);

/* ---------------- direct table writes (master data only) ---------------- */
const MONEY_COLS = { salary_structure: ['basic_kobo','housing_kobo','transport_kobo','other_allowance_kobo','other_fixed_deduction_kobo','annual_rent_kobo'], fee_schedule: ['amount_kobo'], items: ['price_kobo'] };
const checkMoney = (row, cols) => { for(const c of cols) if(!Number.isInteger(row[c]) || row[c] < 0) bad('Amount must be a whole number of kobo, zero or more (' + c + ')'); };
const dup = (db, t, pred, msg) => { if(db.t[t].some(pred)) bad(msg); };
const INS = {
  classes: (db, r) => { if(!r.name) bad('Class name required'); dup(db, 'classes', x => x.name === r.name, 'Class already exists'); return { level: null, class_teacher: null, capacity: null, ...r }; },
  terms: (db, r) => { dup(db, 'terms', x => x.session === r.session && x.term === r.term, 'Term already exists'); if(r.end_date < r.start_date) bad('End date before start date'); return { status: 'open', ...r }; },
  students: (db, r) => { if(!r.admission_no || !r.surname || !r.first_name) bad('Admission number and names required'); dup(db, 'students', x => x.admission_no === r.admission_no, 'Admission number already exists');
    if(r.class_name && !db.t.classes.some(c => c.name === r.class_name)) bad('Unknown class'); return { status: 'active', gender: null, date_of_birth: null, guardian: null, phone: null, class_name: null, created_at: new Date().toISOString(), ...r }; },
  fee_schedule: (db, r) => { inArr(r.category, CATS, 'category'); checkMoney(r, MONEY_COLS.fee_schedule); if(!db.t.classes.some(c => c.name === r.class_name)) bad('Unknown class');
    dup(db, 'fee_schedule', x => x.session === r.session && x.term === r.term && x.class_name === r.class_name && x.category === r.category, 'That fee already exists - edit it instead'); return r; },
  staff: (db, r) => { if(!r.staff_no || !r.surname || !r.first_name) bad('Staff number and names required'); dup(db, 'staff', x => x.staff_no === r.staff_no, 'Staff number already exists'); return { status: 'active', ...r }; },
  salary_structure: (db, r) => { if(!db.t.staff.some(s => s.id === r.staff_id)) bad('Unknown staff'); dup(db, 'salary_structure', x => x.staff_id === r.staff_id, 'Salary already set');
    const row = { basic_kobo: 0, housing_kobo: 0, transport_kobo: 0, other_allowance_kobo: 0, other_fixed_deduction_kobo: 0, annual_rent_kobo: 0, pension_applies: true, ...r }; checkMoney(row, MONEY_COLS.salary_structure); return row; },
  items: (db, r) => { inArr(r.category, STOCKCATS, 'stock category'); dup(db, 'items', x => x.code === r.code, 'Item code already exists'); const row = { price_kobo: 0, reorder_level: 0, ...r }; checkMoney(row, MONEY_COLS.items); return row; }
};
const UPD = { students: ['surname','first_name','gender','date_of_birth','class_name','status','guardian','phone','admission_date'], classes: ['level','class_teacher','capacity'], terms: ['start_date','end_date','status'],
  fee_schedule: ['amount_kobo'], staff: ['surname','first_name','position','department','status','bank','account_no','phone','employment_date','email'],
  salary_structure: ['basic_kobo','housing_kobo','transport_kobo','other_allowance_kobo','other_fixed_deduction_kobo','annual_rent_kobo','pension_applies'], items: ['name','category','price_kobo','reorder_level'],
  schools: ['name','address','phone','email','overpayment_policy'] };

/* ---------------- business functions (port of the cloud database functions) ---------------- */
const RPC = {};
RPC.create_school = (db, a) => {
  if(db.t.schools.length) bad('This browser already has a school');
  const pre = String(a.p_prefix || 'NMI').toUpperCase(); if(!/^[A-Z0-9]{2,8}$/.test(pre)) bad('Receipt prefix must be 2-8 letters or digits'); if(!String(a.p_name || '').trim()) bad('School name required');
  const s = { id: uid(), name: a.p_name.trim(), address: null, phone: null, email: null, receipt_prefix: pre, overpayment_policy: 'allow', created_at: new Date().toISOString() };
  db.t.schools.push(s); db.t.profiles.push({ id: LOCAL_USER.id, school_id: s.id, full_name: a.p_full_name || 'Owner', role: 'owner', active: true }); return s;
};
RPC.add_member = () => bad('Team logins are not used in the single-browser edition');
const addPay = (db, o) => { const s = sid(db), y = yr(o.date), n = serial(db, 'receipt', y);
  const row = { id: uid(), school_id: s, receipt_no: school(db).receipt_prefix + '/' + y + '/' + pad(n, 5), serial: n, pay_date: o.date, entry_type: o.type, student_id: o.student, category: o.category, method: o.method,
    amount_kobo: o.amount, signed_kobo: o.signed, advance_kobo: o.advance, ar_kobo: o.signed - o.advance, original_id: o.original || null, reason: o.reason || null, client_ref: o.ref, received_by: LOCAL_USER.id, created_at: ts(db) };
  db.t.payments.push(row); return row; };
const byRef = (db, t, ref) => db.t[t].find(x => x.client_ref === ref);
RPC.record_payment = (db, a) => {
  sid(db); const ex = byRef(db, 'payments', a.p_client_ref); if(ex) return ex;
  if(!(a.p_amount_kobo > 0) || !Number.isInteger(a.p_amount_kobo)) bad('Amount must be positive'); if(!a.p_date) bad('Date required'); inArr(a.p_category, CATS, 'category'); inArr(a.p_method, METHODS, 'method');
  if(!stuOf(db, a.p_student_id)) bad('Unknown student');
  const b = balance(db, a.p_student_id), arPrior = sum(db.t.payments.filter(p => p.student_id === a.p_student_id), p => p.ar_kobo), out = b.billed_kobo - arPrior;
  const excess = Math.max(0, a.p_amount_kobo - Math.max(0, out));
  if(excess > 0 && school(db).overpayment_policy === 'block') bad('Overpayment not allowed by school policy (excess N' + excess / 100 + ')');
  return addPay(db, { date: a.p_date, type: 'payment', student: a.p_student_id, category: a.p_category, method: a.p_method, amount: a.p_amount_kobo, signed: a.p_amount_kobo, advance: excess, reason: a.p_note, ref: a.p_client_ref });
};
RPC.reverse_payment = (db, a) => {
  sid(db); const ex = byRef(db, 'payments', a.p_client_ref); if(ex) return ex;
  if(!String(a.p_reason || '').trim()) bad('A reason is required');
  const o = db.t.payments.find(p => p.id === a.p_payment_id); if(!o) bad('Receipt not found'); if(o.entry_type !== 'payment') bad('Only a payment can be reversed');
  if(db.t.payments.some(p => p.original_id === o.id && p.entry_type === 'reversal')) bad('Receipt ' + o.receipt_no + ' is already reversed');
  const adv = sum(db.t.payments.filter(p => p.student_id === o.student_id), p => p.advance_kobo); if(adv - o.advance_kobo < 0) bad('Cannot reverse: the overpayment from this receipt was already refunded');
  return addPay(db, { date: a.p_date || today(), type: 'reversal', student: o.student_id, category: o.category, method: o.method, amount: o.amount_kobo, signed: -o.signed_kobo, advance: -o.advance_kobo, original: o.id, reason: a.p_reason, ref: a.p_client_ref });
};
RPC.refund_overpayment = (db, a) => {
  sid(db); const ex = byRef(db, 'payments', a.p_client_ref); if(ex) return ex;
  if(!(a.p_amount_kobo > 0)) bad('Amount must be positive'); if(!String(a.p_reason || '').trim()) bad('A reason is required'); inArr(a.p_method, METHODS, 'method'); if(!stuOf(db, a.p_student_id)) bad('Unknown student');
  const adv = sum(db.t.payments.filter(p => p.student_id === a.p_student_id), p => p.advance_kobo);
  if(a.p_amount_kobo > adv) bad("Refund exceeds the student's credit balance (N" + adv / 100 + ')');
  return addPay(db, { date: a.p_date, type: 'refund', student: a.p_student_id, category: 'School Fees', method: a.p_method, amount: a.p_amount_kobo, signed: -a.p_amount_kobo, advance: -a.p_amount_kobo, reason: a.p_reason, ref: a.p_client_ref });
};
const addInv = (db, o) => { const s = sid(db), y = yr(o.date), n = serial(db, 'invoice', y);
  const row = { id: uid(), school_id: s, invoice_no: 'INV/' + y + '/' + pad(n, 5), invoice_date: o.date, student_id: o.student, session: o.session, term: o.term, category: o.category, line_type: o.type || 'invoice',
    gross_kobo: o.gross, discount_kobo: o.discount || 0, waiver_kobo: o.waiver || 0, waiver_approved_by: o.by || null, net_kobo: o.gross - (o.discount || 0) - (o.waiver || 0), note: o.note || null, created_by: LOCAL_USER.id, created_at: ts(db) };
  db.t.invoices.push(row); return row; };
RPC.add_invoice = (db, a) => {
  sid(db); if(!stuOf(db, a.p_student_id)) bad('Unknown student'); inArr(a.p_category, CATS, 'category'); const lt = a.p_line_type || 'invoice'; inArr(lt, ['invoice', 'credit_note'], 'type');
  const g = a.p_gross_kobo, d = a.p_discount_kobo || 0, w = a.p_waiver_kobo || 0; if(!Number.isInteger(g)) bad('Amount required'); if(d < 0 || w < 0) bad('Discount and waiver cannot be negative');
  if(w > 0 && !String(a.p_waiver_by || '').trim()) bad('A waiver needs the name of the approver');
  if(lt === 'invoice' && g < 0) bad('Invoice amount cannot be negative - use a credit note'); if(lt === 'credit_note' && g >= 0) bad('A credit note must be a negative amount');
  if(lt === 'invoice' && g - d - w < 0) bad('Discount and waiver exceed the fee');
  if(lt === 'invoice' && db.t.invoices.some(i => i.student_id === a.p_student_id && i.session === a.p_session && i.term === a.p_term && i.category === a.p_category && i.line_type === 'invoice')) bad('This fee is already invoiced for this student this term');
  return addInv(db, { date: a.p_date, student: a.p_student_id, session: a.p_session, term: a.p_term, category: a.p_category, gross: g, discount: d, waiver: w, by: a.p_waiver_by, note: a.p_note, type: lt });
};
RPC.generate_invoices = (db, a) => {
  sid(db); let n = 0; const date = a.p_date || today();
  const studs = db.t.students.filter(s => s.status === 'active' && s.class_name === a.p_class).sort((x, y) => x.admission_no < y.admission_no ? -1 : 1);
  for(const s of studs){
    const fees = db.t.fee_schedule.filter(f => f.class_name === s.class_name && f.session === a.p_session && f.term === a.p_term).sort((x, y) => x.category < y.category ? -1 : 1);
    for(const f of fees){
      if(db.t.invoices.some(i => i.student_id === s.id && i.session === a.p_session && i.term === a.p_term && i.category === f.category && i.line_type === 'invoice')) continue;
      addInv(db, { date, student: s.id, session: a.p_session, term: a.p_term, category: f.category, gross: f.amount_kobo }); n++;
    }
  }
  return n;
};
/* payroll */
const defaultSettings = s => ({ id: uid(), school_id: s, max_nonstat_pct: 0.3333, pension_emp: 0.08, pension_er: 0.10, rent_pct: 0.20, rent_cap_kobo: 50000000,
  tax_bands: [[0, 0], [80000000, 0.15], [300000000, 0.18], [1200000000, 0.21], [2500000000, 0.23], [5000000000, 0.25]] });
RPC.generate_payroll = (db, a) => {
  const s = sid(db), m = mstart(a.p_month), me_ = mend(m); let ps = db.t.payroll_settings[0]; if(!ps){ ps = defaultSettings(s); db.t.payroll_settings.push(ps); }
  const bands = [...ps.tax_bands].sort((x, y) => x[0] - y[0]); let n = 0;
  const staff = db.t.staff.filter(x => x.status === 'active').sort((x, y) => x.staff_no < y.staff_no ? -1 : 1);
  for(const st of staff){
    const r = db.t.salary_structure.find(x => x.staff_id === st.id); if(!r) continue;
    if(db.t.payroll_lines.some(l => l.staff_id === st.id && l.month === m && l.status === 'approved')) continue;
    const old = db.t.payroll_lines.find(l => l.staff_id === st.id && l.month === m && l.status === 'draft'); const extra = old ? old.extra_kobo : 0, ovr = old ? old.override_by : null;
    db.t.payroll_lines = db.t.payroll_lines.filter(l => !(l.staff_id === st.id && l.month === m && l.status === 'draft'));
    const gross = r.basic_kobo + r.housing_kobo + r.transport_kobo + r.other_allowance_kobo, base = r.basic_kobo + r.housing_kobo + r.transport_kobo;
    const pen = r.pension_applies ? rhu(base * bp(ps.pension_emp), 10000) : 0, per = r.pension_applies ? rhu(base * bp(ps.pension_er), 10000) : 0;
    const rent = Math.min(ps.rent_cap_kobo, rhu(bp(ps.rent_pct) * r.annual_rent_kobo, 10000)), taxable = Math.max(0, 12 * gross - 12 * pen - rent);
    let tax = 0, prev = 0; for(const [lo, rt] of bands){ if(taxable > lo) tax += (taxable - lo) * (bp(rt) - prev); prev = bp(rt); }
    const paye = rhu(tax, 10000 * 12);
    const inst = sum(db.t.loans.filter(l => l.staff_id === st.id && l.status === 'active' && l.first_repay_month <= m), l => l.monthly_kobo);
    const issued = sum(db.t.loans.filter(l => l.staff_id === st.id && l.issue_date <= me_), l => l.amount_kobo);
    const repaid = sum(db.t.payroll_lines.filter(l => l.staff_id === st.id && l.status === 'approved' && l.month < m), l => l.loan_kobo);
    const loan = Math.max(0, Math.min(inst, issued - repaid)), lim = rhu(gross * bp(ps.max_nonstat_pct), 10000), ded = pen + paye + loan + r.other_fixed_deduction_kobo + extra, net = gross - ded;
    const stat = net < 0 ? 'BLOCKED' : (loan + r.other_fixed_deduction_kobo + extra <= lim ? 'OK' : (ovr ? 'OVERRIDE' : 'BLOCKED'));
    db.t.payroll_lines.push({ id: uid(), school_id: s, staff_id: st.id, month: m, basic_kobo: r.basic_kobo, housing_kobo: r.housing_kobo, transport_kobo: r.transport_kobo, other_allow_kobo: r.other_allowance_kobo, gross_kobo: gross,
      pension_emp_kobo: pen, pension_er_kobo: per, annual_taxable_kobo: taxable, paye_kobo: paye, loan_kobo: loan, other_fixed_kobo: r.other_fixed_deduction_kobo, extra_kobo: extra, override_by: ovr,
      total_ded_kobo: ded, net_kobo: net, limit_status: stat, status: 'draft', approved_by: null, approved_at: null }); n++;
  }
  return n;
};
RPC.set_payroll_adjustment = (db, a) => {
  sid(db); const l = db.t.payroll_lines.find(x => x.id === a.p_line_id); if(!l) bad('Payroll line not found'); if(l.status !== 'draft') bad('Approved payroll cannot be changed'); if(a.p_extra_kobo < 0) bad('Deduction cannot be negative');
  l.extra_kobo = a.p_extra_kobo; l.override_by = a.p_authorise_override ? (me(db).full_name || 'Owner') : null; RPC.generate_payroll(db, { p_month: l.month });
};
RPC.approve_payroll = (db, a) => {
  sid(db); const m = mstart(a.p_month); let ap = 0, bl = 0;
  for(const l of db.t.payroll_lines.filter(x => x.month === m && x.status === 'draft')){ if(l.limit_status === 'BLOCKED') bl++; else { l.status = 'approved'; l.approved_by = LOCAL_USER.id; l.approved_at = new Date().toISOString(); ap++; } }
  return { approved: ap, blocked: bl };
};
RPC.mark_payroll_paid = (db, a) => {
  const s = sid(db), m = mstart(a.p_month); let n = 0;
  for(const l of db.t.payroll_lines.filter(x => x.month === m && x.status === 'approved')){ if(db.t.payroll_payments.some(p => p.line_id === l.id)) continue; db.t.payroll_payments.push({ id: uid(), school_id: s, line_id: l.id, paid_date: a.p_date || today(), method: a.p_method || 'Bank Transfer', paid_by: LOCAL_USER.id }); n++; }
  return n;
};
RPC.issue_loan = (db, a) => {
  const s = sid(db), ex = byRef(db, 'loans', a.p_client_ref); if(ex) return ex; if(!db.t.staff.some(x => x.id === a.p_staff_id)) bad('Unknown staff member');
  if(!(a.p_amount_kobo > 0) || !(a.p_monthly_kobo > 0)) bad('Amount and monthly repayment must be positive'); inArr(a.p_kind, ['loan', 'advance'], 'type'); inArr(a.p_method, METHODS, 'method');
  const y = yr(a.p_date), n = serial(db, 'loan', y);
  const row = { id: uid(), school_id: s, loan_no: 'LN/' + y + '/' + pad(n, 4), staff_id: a.p_staff_id, issue_date: a.p_date, kind: a.p_kind, amount_kobo: a.p_amount_kobo, monthly_kobo: a.p_monthly_kobo,
    first_repay_month: mstart(a.p_first_month), method: a.p_method, approved_by: LOCAL_USER.id, approved_name: me(db).full_name || 'Owner', status: 'active', client_ref: a.p_client_ref, created_at: ts(db) };
  db.t.loans.push(row); return row;
};
RPC.set_loan_status = (db, a) => { sid(db); inArr(a.p_status, ['active', 'cleared', 'written_off'], 'status'); const l = db.t.loans.find(x => x.id === a.p_loan_id); if(!l) bad('Loan not found'); l.status = a.p_status; };
/* expenses */
RPC.create_expense = (db, a) => {
  const s = sid(db), ex = byRef(db, 'expenses', a.p_client_ref); if(ex) return ex; inArr(a.p_category, EXPCATS, 'category'); inArr(a.p_pay_mode, [...METHODS, 'Credit'], 'payment mode');
  if(!(a.p_amount_kobo > 0)) bad('Amount must be positive'); if(!String(a.p_payee || '').trim() || !String(a.p_description || '').trim()) bad('Payee and description required');
  const y = yr(a.p_date), n = serial(db, 'expense', y);
  const row = { id: uid(), school_id: s, expense_no: 'EXP/' + y + '/' + pad(n, 4), expense_date: a.p_date, category: a.p_category, payee: a.p_payee, description: a.p_description, amount_kobo: a.p_amount_kobo, pay_mode: a.p_pay_mode,
    doc_ref: String(a.p_doc_ref || '').trim() || null, requested_by: LOCAL_USER.id, status: 'pending', approved_by: null, decided_at: null, decision_note: null, voucher_no: null, client_ref: a.p_client_ref, created_at: ts(db) };
  db.t.expenses.push(row); return row;
};
RPC.decide_expense = (db, a) => {
  sid(db); const e = db.t.expenses.find(x => x.id === a.p_expense_id); if(!e) bad('Expense not found'); if(e.status !== 'pending') bad('Already ' + e.status);
  if(a.p_approve){ if(!e.doc_ref) bad('A supporting document reference is required before approval'); const y = yr(e.expense_date), n = serial(db, 'voucher', y); e.status = 'approved'; e.voucher_no = 'PV/' + y + '/' + pad(n, 4); }
  else { if(!String(a.p_note || '').trim()) bad('A reason is required to reject'); e.status = 'rejected'; }
  e.approved_by = LOCAL_USER.id; e.decided_at = new Date().toISOString(); e.decision_note = a.p_note || null; return e;
};
RPC.settle_expense = (db, a) => {
  const s = sid(db), e = db.t.expenses.find(x => x.id === a.p_expense_id); if(!e) bad('Expense not found'); inArr(a.p_method, METHODS, 'method');
  if(e.status !== 'approved' || e.pay_mode !== 'Credit') bad('Only approved credit expenses are settled here'); if(db.t.expense_payments.some(p => p.expense_id === e.id)) bad('Already settled');
  db.t.expense_payments.push({ id: uid(), school_id: s, expense_id: e.id, paid_date: a.p_date || today(), method: a.p_method, paid_by: LOCAL_USER.id });
};
/* stock */
const itemBalance = (db, id) => sum(db.t.stock_purchases.filter(p => p.item_id === id), p => p.signed_qty) - sum(db.t.stock_sales.filter(p => p.item_id === id), p => p.signed_qty);
RPC.record_purchase = (db, a) => {
  const s = sid(db), ex = byRef(db, 'stock_purchases', a.p_client_ref); if(ex) return ex; inArr(a.p_kind, ['purchase', 'supplier_return', 'opening'], 'type');
  if(!db.t.items.some(i => i.id === a.p_item_id)) bad('Unknown item'); if(!(a.p_qty > 0) || !Number.isInteger(a.p_qty)) bad('Quantity must be a whole number above zero'); if(!(a.p_unit_cost_kobo >= 0)) bad('Unit cost required');
  let mode = a.p_pay_mode; if(a.p_kind === 'opening') mode = 'Opening Stock'; else if(mode === 'Opening Stock') bad('Use type Opening for opening stock'); inArr(mode, [...METHODS, 'Credit', 'Opening Stock'], 'payment mode');
  const sign = a.p_kind === 'supplier_return' ? -1 : 1; if(sign < 0 && a.p_qty > itemBalance(db, a.p_item_id)) bad('Supplier return exceeds stock on hand (' + itemBalance(db, a.p_item_id) + ')');
  const y = yr(a.p_date), n = serial(db, 'stock_purchase', y);
  const row = { id: uid(), school_id: s, ref_no: 'STP/' + y + '/' + pad(n, 4), purchase_date: a.p_date, kind: a.p_kind, supplier: a.p_supplier || null, item_id: a.p_item_id, qty: a.p_qty, unit_cost_kobo: a.p_unit_cost_kobo,
    signed_qty: sign * a.p_qty, signed_cost_kobo: sign * a.p_qty * a.p_unit_cost_kobo, pay_mode: mode, doc_ref: a.p_doc_ref || null, client_ref: a.p_client_ref, created_at: ts(db) };
  db.t.stock_purchases.push(row); return row;
};
RPC.record_sale = (db, a) => {
  const s = sid(db), ex = byRef(db, 'stock_sales', a.p_client_ref); if(ex) return ex; inArr(a.p_kind, ['sale', 'return'], 'type');
  const it = db.t.items.find(i => i.id === a.p_item_id); if(!it) bad('Unknown item'); if(!(a.p_qty > 0) || !Number.isInteger(a.p_qty)) bad('Quantity must be a whole number above zero');
  const mode = a.p_pay_mode || 'Cash'; inArr(mode, [...METHODS, 'Student Account'], 'payment mode'); if(a.p_student_id && !stuOf(db, a.p_student_id)) bad('Unknown student'); if(mode === 'Student Account' && !a.p_student_id) bad('A student is required for Student Account sales');
  const ps = db.t.stock_purchases.filter(p => p.item_id === a.p_item_id && p.purchase_date <= a.p_date), sq = sum(ps, p => p.signed_qty), sc = sum(ps, p => p.signed_cost_kobo);
  const avail = sq - sum(db.t.stock_sales.filter(x => x.item_id === a.p_item_id), x => x.signed_qty);
  if(a.p_kind === 'sale' && a.p_qty > avail) bad('Insufficient stock: ' + avail + ' available');
  const sign = a.p_kind === 'return' ? -1 : 1, price = (a.p_unit_price_kobo === null || a.p_unit_price_kobo === undefined) ? it.price_kobo : a.p_unit_price_kobo, cogs = sq > 0 ? rhu(a.p_qty * sc, sq) : 0;
  const y = yr(a.p_date), n = serial(db, 'stock_sale', y);
  const row = { id: uid(), school_id: s, ref_no: 'STS/' + y + '/' + pad(n, 4), sale_date: a.p_date, kind: a.p_kind, item_id: a.p_item_id, qty: a.p_qty, unit_price_kobo: price, student_id: a.p_student_id || null, pay_mode: mode,
    signed_qty: sign * a.p_qty, total_kobo: sign * a.p_qty * price, cogs_kobo: sign * cogs, doc_ref: a.p_doc_ref || null, client_ref: a.p_client_ref, created_at: ts(db) };
  db.t.stock_sales.push(row); return row;
};

/* ---------------- supabase-js compatible surface ---------------- */
const clone = x => JSON.parse(JSON.stringify(x));
function from(t){
  const q = { orders: [], lim: null, eqs: [] };
  const run = async single => {
    try {
      const db = await read(); let rows = V[t] ? V[t](db) : (db.t[t] ? db.t[t] : bad('Unknown table ' + t));
      for(const [c, v] of q.eqs) rows = rows.filter(r => r[c] === v);
      for(const [c, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => { const a = x[c], b = y[c]; if(a === b) return 0; if(a === null || a === undefined) return 1; if(b === null || b === undefined) return -1; return (a < b ? -1 : 1) * (asc ? 1 : -1); });
      if(q.lim) rows = rows.slice(0, q.lim); rows = clone(rows);
      return { data: single ? (rows[0] || null) : rows, error: null };
    } catch(e){ return { data: null, error: { message: e.message } }; }
  };
  const b = { select(){ return b; }, order(c, o){ q.orders.push([c, !(o && o.ascending === false)]); return b; }, limit(n){ q.lim = n; return b; }, eq(c, v){ q.eqs.push([c, v]); return b; },
    maybeSingle(){ return run(true); }, then(ok, no){ return run(false).then(ok, no); },
    insert(row){ return doInsert(t, row); },
    update(row){ return { eq: (c, v) => doUpdate(t, row, c, v) }; } };
  return b;
}
async function doInsert(t, row){
  try { await mutate(db => { if(!INS[t]) bad('Not permitted'); if(t !== 'schools') sid(db); const r = INS[t](db, { id: uid(), school_id: school(db).id, ...row }); db.t[t].push(r); }); return { error: null }; }
  catch(e){ return { error: { message: e.message } }; }
}
async function doUpdate(t, row, c, v){
  try { await mutate(db => { if(!UPD[t]) bad('Not permitted'); const r = db.t[t].find(x => x[c] === v); if(!r) bad('Record not found');
    for(const k of Object.keys(row)){ if(!UPD[t].includes(k)) bad('Field cannot be changed: ' + k); }
    if(MONEY_COLS[t]) checkMoney({ ...r, ...row }, MONEY_COLS[t]);
    Object.assign(r, row); }); return { error: null }; }
  catch(e){ return { error: { message: e.message } }; }
}
const client = {
  auth: { getSession: async () => ({ data: { session: { user: LOCAL_USER } }, error: null }), signOut: async () => ({}), signInWithPassword: async () => ({ error: null }), signUp: async () => ({ data: { session: {} }, error: null }), resetPasswordForEmail: async () => ({ error: null }) },
  from,
  rpc: async (fn, args) => { try { if(!RPC[fn]) bad('Unknown function ' + fn); const data = await mutate(db => RPC[fn](db, args || {})); return { data, error: null }; } catch(e){ return { data: null, error: { message: e.message } }; } },
  channel(){ const ch = { on(){ return ch; }, subscribe(cb){ if(cb) cb('SUBSCRIBED'); return ch; } }; return ch; },
  removeChannel(){}
};

/* ---------------- dashboard password (salted + iterated SHA-256, kept in the same local database) ---------------- */
const SHA = (() => {
  const K = [], H0 = [];
  (function(){ let n = 2, c = 0; while(c < 64){ let p = true; for(let d = 2; d * d <= n; d++) if(n % d === 0){ p = false; break; } if(p){ if(c < 8) H0[c] = (Math.pow(n, .5) % 1 * 4294967296) | 0; K[c] = (Math.pow(n, 1 / 3) % 1 * 4294967296) | 0; c++; } n++; } })();
  return bytes => {
    const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(nb); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(nb - 8, Math.floor(l * 8 / 4294967296)); dv.setUint32(nb - 4, (l * 8) >>> 0);
    const h = H0.slice(), w = new Array(64);
    for(let o = 0; o < nb; o += 64){
      for(let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for(let i = 16; i < 64; i++){ const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) | 0; }
      let [a, b, c, d, e, f, g, hh] = h;
      for(let i = 0; i < 64; i++){
        const t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer); h.forEach((x, i) => ov.setUint32(i * 4, x >>> 0)); return out;
  };
})();
const utf8 = s => new TextEncoder().encode(s);
const hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
const rnd = n => { const u = new Uint8Array(n); if(root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(u); else for(let i = 0; i < n; i++) u[i] = Math.random() * 256 | 0; return u; };
const ITER = 20000;
function stretch(pw, salt){ const sb = utf8(salt); let x = SHA(utf8(salt + '|' + pw)); for(let i = 0; i < ITER; i++){ const m = new Uint8Array(x.length + sb.length); m.set(x); m.set(sb, x.length); x = SHA(m); } return hex(x); }
const mkSecret = pw => { const salt = hex(rnd(16)); return { salt, hash: stretch(pw, salt) }; };
const okSecret = (o, pw) => !!o && stretch(pw, o.salt) === o.hash;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => { const u = rnd(12); let s = ''; for(let i = 0; i < 12; i++){ s += CODE_CHARS[u[i] % 32]; if(i % 4 === 3 && i < 11) s += '-'; } return s; };
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* cross-tab refresh hook: the app re-reads when another tab saves */
const api = {
  onExternalChange(fn){ listeners.push(fn); },
  async exportJSON(){ const db = await read(); db.meta.lastBackup = new Date().toISOString(); await lock(async () => { const cur = norm(await idbGet()); cur.meta.lastBackup = db.meta.lastBackup; await idbPut(cur); }); return JSON.stringify({ app: 'noble-minds-school-accounting', format: 1, exported_at: db.meta.lastBackup, data: db }); },
  async importJSON(text){ const o = JSON.parse(text); if(!o || o.app !== 'noble-minds-school-accounting' || !o.data || !o.data.t) throw new Error('This is not a Noble Minds backup file'); const db = norm(o.data); for(const t of TABLES) if(!Array.isArray(db.t[t])) throw new Error('Backup is incomplete: ' + t); await lock(async () => { await idbPut(db); notify(); }); },
  async reset(){ await lock(async () => { await idbPut(fresh()); notify(); }); },
  async lastBackup(){ return (await read()).meta.lastBackup; },
  async dashState(){ return { set: !!(await read()).meta.dash }; },
  async dashCreate(pw){ if(String(pw || '').length < 6) throw new Error('Use at least 6 characters'); const code = genCode();
    await lock(async () => { const db = norm(await idbGet()); if(db.meta.dash) throw new Error('A dashboard password already exists'); db.meta.dash = { pw: mkSecret(String(pw)), rc: mkSecret(normCode(code)) }; await idbPut(db); notify(); }); return code; },
  async dashCheck(pw){ const d = (await read()).meta.dash; return !!d && okSecret(d.pw, String(pw || '')); },
  async dashChange(proof, newPw){   // proof: { password } or { code }; returns a NEW recovery code when reset by code, else null
    if(String(newPw || '').length < 6) throw new Error('Use at least 6 characters'); let code = null;
    await lock(async () => { const db = norm(await idbGet()), d = db.meta.dash; if(!d) throw new Error('No dashboard password is set');
      if(proof.code !== undefined){ if(!okSecret(d.rc, normCode(proof.code))) throw new Error('That recovery code is not correct'); code = genCode(); d.rc = mkSecret(normCode(code)); }
      else if(!okSecret(d.pw, String(proof.password || ''))) throw new Error('The current password is not correct');
      d.pw = mkSecret(String(newPw)); await idbPut(db); notify(); }); return code; },
  async hasSchool(){ return (await read()).t.schools.length > 0; }
};
root.supabase = { createClient: () => client };
root.NM_LOCAL_API = api;
if(typeof module !== 'undefined') module.exports = { client, api, V, RPC, _sha: SHA };
})(typeof window !== 'undefined' ? window : globalThis);
