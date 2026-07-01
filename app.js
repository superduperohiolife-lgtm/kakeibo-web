/* app.js — Webダッシュボード（月切替対応・金額は円） */
(function () {
  'use strict';

  var GAS_URL = (window.KAKEIBO_CONFIG || {}).GAS_URL || '';
  var TOKEN_KEY = 'kakeibo_token';
  var state = { month: null, plans: [], txns: [] };
  var charts = {};

  var DAILY_CATS = ['ライフライン', '食費', '日用品', '衣料・服飾', '外食', '交通', '医療・健康', '雑費'];
  var EXTRA_CATS = ['家電', '家具・インテリア', '調理・食器', '生活用品（大型）', '自転車・乗り物', '旅行・レジャー', '車関連', '住宅・修繕', '冠婚葬祭', '医療・税金・保険（高額/年払い）', 'その他臨時'];

  var el = function (id) { return document.getElementById(id); };
  var yen = function (n) { return '¥' + (Math.round(Number(n) || 0)).toLocaleString('ja-JP'); };
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ===== API =====
  function apiGet(action, params) {
    var url = GAS_URL + '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(getToken());
    if (params) for (var k in params) url += '&' + k + '=' + encodeURIComponent(params[k]);
    return fetch(url).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    payload.token = getToken();
    return fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }).then(function (r) { return r.json(); });
  }

  // ===== 月セレクタ =====
  function currentYm() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  function initMonths() {
    var sel = el('monthSel');
    var d = new Date();
    var html = '';
    for (var i = 0; i < 12; i++) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      var ym = y + '-' + ('0' + m).slice(-2);
      html += '<option value="' + ym + '">' + y + '年' + m + '月</option>';
      d.setMonth(d.getMonth() - 1);
    }
    sel.innerHTML = html;
    state.month = currentYm();
    sel.value = state.month;
    sel.addEventListener('change', function () {
      state.month = sel.value;
      loadOverview(); loadTransactions(); loadAnalysis();
    });
  }

  // ===== 合言葉 =====
  function ensureAuth() {
    if (getToken()) { el('authView').classList.add('hidden'); return true; }
    el('authView').classList.remove('hidden'); return false;
  }
  el('saveTokenBtn').addEventListener('click', function () {
    var t = el('tokenInput').value.trim();
    if (!t) { el('authError').textContent = '合言葉を入力してください'; return; }
    localStorage.setItem(TOKEN_KEY, t);
    apiGet('ping').then(function (res) {
      if (res && res.ok) { el('authView').classList.add('hidden'); loadAll(); }
      else { localStorage.removeItem(TOKEN_KEY); el('authError').textContent = '合言葉が違うようです'; }
    }).catch(function () { el('authError').textContent = '接続できません。config.jsのURLを確認してください'; });
  });

  // ===== タブ =====
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      el('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ===== 読み込み =====
  function loadAll() { loadOverview(); loadTransactions(); loadPlans(); loadAnalysis(); }

  function loadOverview() {
    apiGet('overview', { month: state.month }).then(function (d) {
      if (!d || d.error) return;
      el('genTime').textContent = state.month + ' 表示';
      var t = d.totals || {};
      el('totalAll').textContent = yen(t.all);
      el('totalDaily').textContent = yen(t.daily);
      el('totalExtra').textContent = yen(t.extraordinary);
      var rb = el('reviewBadge');
      if (d.needs_review_count > 0) { rb.classList.remove('hidden'); rb.textContent = '⚠ 要確認の取引が ' + d.needs_review_count + ' 件あります（「取引」タブで修正してください）'; }
      else rb.classList.add('hidden');
      renderCatChart(d.by_category || []);
      renderTrendChart(d.daily_trend || []);
      renderPlanVsActual(d.plan_vs_actual || []);
    });
  }

  function renderCatChart(data) {
    var ctx = el('catChart');
    if (charts.cat) charts.cat.destroy();
    if (!data.length) { ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height); return; }
    charts.cat = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: data.map(function (x) { return x.category; }), datasets: [{ data: data.map(function (x) { return x.amount; }), backgroundColor: ['#1f7a5a', '#3a9d78', '#5cbf9a', '#b5651d', '#d18a4a', '#e0a96d', '#8888aa', '#aabbcc', '#ccbbaa', '#99bbbb', '#7799aa'] }] },
      options: { plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
  }
  function renderTrendChart(data) {
    var ctx = el('trendChart');
    if (charts.trend) charts.trend.destroy();
    charts.trend = new Chart(ctx, {
      type: 'bar',
      data: { labels: data.map(function (x) { return x.date.substring(5); }), datasets: [{ label: '日次支出', data: data.map(function (x) { return x.amount; }), backgroundColor: '#3a9d78' }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: function (v) { return '¥' + v.toLocaleString(); } } } } }
    });
  }
  function renderPlanVsActual(data) {
    var box = el('planVsActual');
    if (!data.length) { box.innerHTML = '<span class="muted">予定支出が登録されていません</span>'; return; }
    box.innerHTML = '';
    data.forEach(function (p) {
      var pct = p.planned > 0 ? Math.min(100, Math.round(p.actual / p.planned * 100)) : 0;
      var over = p.actual > p.planned && p.planned > 0;
      var row = document.createElement('div');
      row.className = 'pva-row';
      row.innerHTML = '<div class="pva-head"><span>' + escapeHtml(p.category) + '</span><span>' + yen(p.actual) + ' / ' + yen(p.planned) + (over ? ' ⚠超過' : '') + '</span></div>'
        + '<div class="pva-bar"><div class="pva-fill ' + (over ? 'over' : '') + '" style="width:' + (over ? 100 : pct) + '%"></div></div>';
      box.appendChild(row);
    });
  }

  // ===== 取引 =====
  function loadTransactions() {
    apiGet('transactions', { month: state.month }).then(function (r) {
      if (!r || r.error) return;
      state.txns = r.transactions || [];
      el('txMonth').textContent = r.month || '';
      renderTxTable();
    });
  }
  function renderTxTable() {
    var body = el('txBody');
    if (!state.txns.length) { body.innerHTML = '<tr><td colspan="6" class="muted">この月の取引はありません</td></tr>'; return; }
    body.innerHTML = '';
    state.txns.slice().sort(function (a, b) { return (b.purchase_date || '').localeCompare(a.purchase_date || ''); }).forEach(function (t) {
      var tr = document.createElement('tr');
      var amtCell = yen(t.total) + (t.original_currency && t.original_currency !== 'JPY' ? '<br><span class="muted small">(' + escapeHtml(t.original_currency) + ' ' + t.original_total + ')</span>' : '');
      tr.innerHTML = '<td>' + escapeHtml((t.purchase_date || '').substring(5)) + '</td>'
        + '<td>' + escapeHtml(t.store || '(不明)') + '</td>'
        + '<td><span class="tag ' + (t.expense_type === '臨時' ? 'extra' : 'daily') + '">' + escapeHtml(t.expense_type || '') + '</span></td>'
        + '<td>' + escapeHtml(t.category || '') + '</td>'
        + '<td class="num">' + amtCell + '</td>'
        + '<td><span class="tag ' + (t.status === '要確認' ? 'review' : 'ok') + '">' + escapeHtml(t.status || '') + '</span></td>';
      tr.addEventListener('click', function () { openTxEditor(t); });
      body.appendChild(tr);
    });
  }
  function openTxEditor(t) {
    var catOptions = DAILY_CATS.concat(EXTRA_CATS).map(function (c) { return '<option' + (c === t.category ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    var itemsHtml = (t.items && t.items.length)
      ? '<label class="fld">品目明細（円）</label><div class="muted small" style="margin-bottom:10px">' + t.items.map(function (i) { return escapeHtml(i.name || '') + ' ' + yen(i.price || 0); }).join('<br>') + '</div>'
      : '';
    var fxHtml = (t.original_currency && t.original_currency !== 'JPY')
      ? '<div class="muted small" style="margin-bottom:10px">元通貨: ' + escapeHtml(t.original_currency) + ' ' + t.original_total + '（レート ' + t.fx_rate + ' で円換算済み）</div>'
      : '';
    el('modalTitle').textContent = '取引の修正';
    el('modalBody').innerHTML =
      '<label class="fld">店名</label><input id="m_store" value="' + escapeHtml(t.store || '') + '">'
      + '<label class="fld">日付</label><input id="m_date" type="date" value="' + escapeHtml(t.purchase_date || '') + '">'
      + '<label class="fld">金額（円）</label><input id="m_total" type="number" value="' + (t.total != null ? t.total : '') + '">'
      + fxHtml
      + '<label class="fld">区分</label><select id="m_type"><option' + (t.expense_type === '日常' ? ' selected' : '') + '>日常</option><option' + (t.expense_type === '臨時' ? ' selected' : '') + '>臨時</option></select>'
      + '<label class="fld">カテゴリ</label><select id="m_cat">' + catOptions + '</select>'
      + '<label class="fld">状態</label><select id="m_status"><option' + (t.status === '確定' ? ' selected' : '') + '>確定</option><option' + (t.status === '要確認' ? ' selected' : '') + '>要確認</option></select>'
      + itemsHtml
      + '<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px"><button id="m_delete" class="del-btn">この取引を削除</button><span class="muted small">（重複アップロード時などに使用）</span></div>';
    var delBtn = document.getElementById('m_delete');
    if (delBtn) delBtn.addEventListener('click', function () {
      if (!confirm('この取引を削除しますか？元に戻せません。')) return;
      apiPost({ action: 'delete_txn', month: state.month, id: t.id }).then(function (res) {
        if (res && res.ok) { hideModal(); loadTransactions(); loadOverview(); }
        else alert('削除に失敗: ' + (res && res.error));
      });
    });
    showModal(function () {
      var fields = {
        store: el('m_store').value, purchase_date: el('m_date').value,
        total: Number(el('m_total').value) || 0, expense_type: el('m_type').value,
        category: el('m_cat').value, status: el('m_status').value
      };
      return apiPost({ action: 'correct', month: state.month, id: t.id, fields: fields }).then(function (res) {
        if (res && res.ok) { loadTransactions(); loadOverview(); }
        else alert('保存に失敗: ' + (res && res.error));
      });
    });
  }

  // ===== 予定支出 =====
  function loadPlans() {
    apiGet('plans').then(function (r) { state.plans = (r && r.items) || []; renderPlanTable(); });
  }
  function renderPlanTable() {
    var body = el('planBody');
    if (!state.plans.length) { body.innerHTML = '<tr><td colspan="6" class="muted">予定支出がありません</td></tr>'; return; }
    body.innerHTML = '';
    state.plans.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(p.name || '') + (p.note ? ' <span class="muted small">' + escapeHtml(p.note) + '</span>' : '') + '</td>'
        + '<td><span class="tag ' + (p.expense_type === '臨時' ? 'extra' : 'daily') + '">' + escapeHtml(p.expense_type || '') + '</span></td>'
        + '<td>' + escapeHtml(p.category || '') + '</td>'
        + '<td class="num">' + (p.amount != null ? yen(p.amount) : '<span class="muted">未設定</span>') + '</td>'
        + '<td>' + escapeHtml(p.due_date || '-') + '</td>'
        + '<td><button class="del-btn">削除</button></td>';
      tr.querySelector('.del-btn').addEventListener('click', function (ev) { ev.stopPropagation(); if (confirm('削除しますか？')) apiPost({ action: 'plan', op: 'delete', plan: { id: p.id } }).then(loadPlans).then(loadOverview); });
      tr.addEventListener('click', function () { openPlanEditor(p); });
      body.appendChild(tr);
    });
  }
  el('addPlanBtn').addEventListener('click', function () { openPlanEditor(null); });
  function openPlanEditor(p) {
    p = p || { expense_type: '臨時', category: 'その他臨時' };
    var cats = DAILY_CATS.concat(EXTRA_CATS).map(function (c) { return '<option' + (c === p.category ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    el('modalTitle').textContent = p.id ? '予定支出の編集' : '予定支出の追加';
    el('modalBody').innerHTML =
      '<label class="fld">名称</label><input id="p_name" value="' + escapeHtml(p.name || '') + '">'
      + '<label class="fld">予定額（円）</label><input id="p_amount" type="number" value="' + (p.amount != null ? p.amount : '') + '">'
      + '<label class="fld">予定日</label><input id="p_date" type="date" value="' + escapeHtml(p.due_date || '') + '">'
      + '<label class="fld">区分</label><select id="p_type"><option' + (p.expense_type === '日常' ? ' selected' : '') + '>日常</option><option' + (p.expense_type === '臨時' ? ' selected' : '') + '>臨時</option></select>'
      + '<label class="fld">カテゴリ</label><select id="p_cat">' + cats + '</select>'
      + '<label class="fld">メモ</label><input id="p_note" value="' + escapeHtml(p.note || '') + '">';
    showModal(function () {
      var plan = {
        id: p.id, name: el('p_name').value,
        amount: el('p_amount').value === '' ? null : Number(el('p_amount').value),
        due_date: el('p_date').value || null, expense_type: el('p_type').value,
        category: el('p_cat').value, note: el('p_note').value, status: p.status || '予定'
      };
      return apiPost({ action: 'plan', op: 'upsert', plan: plan }).then(function (res) {
        if (res && res.ok) { loadPlans(); loadOverview(); } else alert('保存に失敗');
      });
    });
  }

  // ===== 分析 =====
  function loadAnalysis() {
    apiGet('dashboard').then(function (d) {
      if (d && d.analysis && d.analysis.text && d.month === state.month) {
        el('analysisText').textContent = d.analysis.text;
        el('analysisText').classList.remove('muted');
        el('analysisTime').textContent = d.analysis.generated_at ? ('生成 ' + d.analysis.generated_at.substring(0, 16).replace('T', ' ')) : '';
      } else {
        el('analysisText').textContent = state.month + ' の分析は「分析を実行」で生成できます。当月は毎日23:00に自動更新されます。';
        el('analysisText').classList.add('muted');
        el('analysisTime').textContent = '';
      }
    });
  }
  el('analyzeBtn').addEventListener('click', function () {
    var btn = el('analyzeBtn'); btn.disabled = true; btn.textContent = '分析中…';
    apiPost({ action: 'analyze', month: state.month }).then(function (res) {
      btn.disabled = false; btn.textContent = '分析を実行';
      if (res && res.text) {
        el('analysisText').textContent = res.text;
        el('analysisText').classList.remove('muted');
        el('analysisTime').textContent = res.generated_at ? ('生成 ' + res.generated_at.substring(0, 16).replace('T', ' ')) : '';
      } else alert('分析に失敗: ' + (res && res.error));
    }).catch(function () { btn.disabled = false; btn.textContent = '分析を実行'; alert('接続エラー'); });
  });

  // ===== モーダル =====
  var modalSaveHandler = null;
  function showModal(onSave) { modalSaveHandler = onSave; el('modal').classList.remove('hidden'); }
  function hideModal() { el('modal').classList.add('hidden'); modalSaveHandler = null; }
  el('modalCancel').addEventListener('click', hideModal);
  el('modalSave').addEventListener('click', function () {
    if (!modalSaveHandler) return hideModal();
    var p = modalSaveHandler();
    if (p && p.then) p.then(hideModal); else hideModal();
  });

  el('reloadBtn').addEventListener('click', loadAll);

  // ===== 初期化 =====
  initMonths();
  if (!GAS_URL || GAS_URL.indexOf('<<') === 0) { el('analysisText').textContent = 'config.js に GAS_URL を設定してください'; }
  if (ensureAuth()) loadAll();
})();
