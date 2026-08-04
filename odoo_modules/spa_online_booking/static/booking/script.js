(() => {
  const API = ''; // same-origin: page is served from the Odoo instance itself
  const USE_MOCK = false;

  const t = (key) => window.i18n.t(key);

  // Linear screen flow. THIS is the running order, not the order the
  // <section>s happen to sit in the HTML - screens are shown by class.
  // The first three all map to rail stage 1.
  //
  // Details come before the questions on purpose: we establish who the person
  // is, and only then ask what they are consenting to and take the signature.
  const SCREENS = ['grid', 'therapy', 'package', 'details', 'questions', 'slot', 'review'];
  const PREV = {
    therapy: 'grid', package: 'therapy', details: 'package',
    questions: 'details', slot: 'questions', review: 'slot',
  };
  const STAGE = {
    grid: 1, therapy: 1, package: 1, details: 2, questions: 3, slot: 4, review: 5,
  };

  // The country codes the spa serves. Same list as the POS
  // (static/src/pos/phone_country.js) - a number typed here and a number typed
  // at the till have to come out in the same shape.
  const COUNTRIES = [
    { code: '+968', flag: '\u{1F1F4}\u{1F1F2}', name: 'Oman' },
    { code: '+971', flag: '\u{1F1E6}\u{1F1EA}', name: 'United Arab Emirates' },
    { code: '+966', flag: '\u{1F1F8}\u{1F1E6}', name: 'Saudi Arabia' },
    { code: '+974', flag: '\u{1F1F6}\u{1F1E6}', name: 'Qatar' },
    { code: '+973', flag: '\u{1F1E7}\u{1F1ED}', name: 'Bahrain' },
    { code: '+965', flag: '\u{1F1F0}\u{1F1FC}', name: 'Kuwait' },
    { code: '+91', flag: '\u{1F1EE}\u{1F1F3}', name: 'India' },
    { code: '+44', flag: '\u{1F1EC}\u{1F1E7}', name: 'United Kingdom' },
    { code: '+1', flag: '\u{1F1FA}\u{1F1F8}', name: 'United States' },
  ];
  const DEFAULT_DIAL_CODE = '+968';

  const state = {
    token: null,
    currency: { symbol: '', position: 'before' },
    therapies: [],
    screen: 'grid',
    currentTherapyId: null,
    selectedPackageId: null,   // single package (radio)
    name: '', phone: '', whatsapp: '', dob: '', gender: '', email: '',
    terms: false,
    // Chosen country per phone field, keyed by input id.
    dialCodes: { fieldWhatsapp: DEFAULT_DIAL_CODE, fieldPhone: DEFAULT_DIAL_CODE },
    questions: [],
    answers: {},               // { qid: string | string[] (multi_choice) }
    date: null, slot: null, timeNote: '',
    minBookingDate: null, maxBookingDate: null,
    questionsFor: null,        // package id the loaded questions belong to
  };

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showBanner(msg) { const b = $('#stateBanner'); b.textContent = msg; b.hidden = false; }
  function hideBanner() { $('#stateBanner').hidden = true; }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || 'request_failed');
      err.status = res.status; err.data = json; throw err;
    }
    return json;
  }

  const data = {
    getSession: (token) => USE_MOCK ? window.MOCK_API.getSession(token)
      : api(`/api/spa/session?token=${encodeURIComponent(token)}`),
    getTherapies: () => USE_MOCK ? window.MOCK_API.getTherapies()
      : api('/api/spa/therapies?lang=' + encodeURIComponent(window.i18n.current)),
    getQuestions: (ids) => USE_MOCK ? window.MOCK_API.getQuestions(ids)
      : api(`/api/spa/questions?service_ids=${encodeURIComponent(ids.join(','))}&lang=${encodeURIComponent(window.i18n.current)}`),
    getAvailability: (ids, date) => USE_MOCK ? window.MOCK_API.getAvailability(ids, date)
      : api(`/api/spa/availability?service_ids=${encodeURIComponent(ids.join(','))}&date=${date}`),
    lookupCustomer: (token, phone) => api('/api/spa/lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, phone }),
    }),
    submitBooking: (payload) => USE_MOCK ? window.MOCK_API.submitBooking(payload)
      : api('/api/spa/submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
  };

  const currentTherapy = () => state.therapies.find(th => th.id === state.currentTherapyId) || null;
  const selectedPackage = () => {
    const th = currentTherapy();
    if (!th) return null;
    return th.packages.find(p => p.id === state.selectedPackageId) || null;
  };

  function fmtPrice(v) {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    const num = Number.isInteger(n) ? String(n) : n.toFixed(2);
    const c = state.currency || {};
    if (!c.symbol) return num;
    return c.position === 'after' ? `${num} ${c.symbol}` : `${c.symbol}${num}`;
  }

  function therapyTitle(th) {
    if (!th) return '';
    return th.duration_min ? `${th.name} (${th.duration_min} ${t('min_word')})` : th.name;
  }

  // ---------- init ----------
  async function init() {
    const params = new URLSearchParams(window.location.search);
    state.token = params.get('token');
    if (!state.token) { showBanner(t('err_missing_link')); return; }

    try {
      const session = await data.getSession(state.token);
      state.whatsapp = session.whatsapp_number || '';
      setNumber('fieldWhatsapp', state.whatsapp);
      mirrorWhatsappToPhone();
      state.minBookingDate = session.min_booking_date || null;
      state.maxBookingDate = session.max_booking_date || null;
    } catch (e) {
      showBanner(e.status === 410 ? t('err_expired') : t('err_invalid_link'));
      return;
    }

    try {
      const res = await data.getTherapies();
      state.therapies = res.therapies || [];
      if (res.currency) state.currency = res.currency;
      renderTherapies();
    } catch (e) {
      showBanner(t('err_services_load'));
    }

    $('#fieldDate').min = state.minBookingDate || new Date().toISOString().slice(0, 10);
    if (state.maxBookingDate) $('#fieldDate').max = state.maxBookingDate;
    else $('#fieldDate').removeAttribute('max');

    showScreen('grid');
  }

  // ---------- screen router ----------
  function showScreen(screen) {
    hideBanner();
    state.screen = screen;
    $$('.screen').forEach(s => s.classList.toggle('is-active', s.dataset.screen === screen));

    // app bar (dark) — hidden only on the grid
    const bar = $('#appbar');
    if (screen === 'grid' || screen === 'done') {
      bar.hidden = true;
    } else {
      bar.hidden = false;
      const th = currentTherapy();
      const pkg = selectedPackage();
      let title = therapyTitle(th);
      if (pkg && ['questions', 'details', 'slot', 'review'].includes(screen)) {
        title += ` • ${pkg.name}`;
      }
      $('#appbarTitle').textContent = title;
    }

    // rail
    const stage = STAGE[screen] || 1;
    $$('.rail__item').forEach(li => {
      const n = Number(li.dataset.stage);
      li.classList.toggle('is-active', n === stage);
      li.classList.toggle('is-complete', n < stage);
    });

    // per-screen enter hooks
    if (screen === 'therapy') renderTherapyDetail();
    if (screen === 'package') renderPackageDetail();
    if (screen === 'questions') {
      ensureQuestions();
      setTimeout(setupPad, 0);
    }
    if (screen === 'slot' && state.date) loadSlots();
    if (screen === 'review') renderReview();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    const prev = PREV[state.screen];
    if (prev) showScreen(prev);
  }

  // Validate the current screen, then move to the next one (or submit).
  function advance() {
    if (!validate(state.screen)) {
      showBanner(t(state.validationError || 'err_incomplete_step'));
      return;
    }
    if (state.screen === 'review') { submitBooking(); return; }
    const idx = SCREENS.indexOf(state.screen);
    const next = SCREENS[idx + 1];
    if (next) showScreen(next);
  }

  function validate(screen) {
    state.validationError = null;
    if (screen === 'therapy') return !!state.selectedPackageId;
    if (screen === 'package') return true;
    if (screen === 'questions') {
      const answered = state.questions.every(q => {
        if (!q.required) return true;
        const a = state.answers[q.id];
        return Array.isArray(a) ? a.length > 0 : !!(a && String(a).trim());
      });
      if (!answered) return false;
      // The tick first, then the signature that stands for it.
      if (!$('#fieldTerms').checked) {
        state.validationError = t('terms_required');
        return false;
      }
      state.terms = true;
      // Consent for the service just chosen is given here, so it cannot be
      // skipped - not even by someone who has booked with us before.
      if (!sig.data) { state.validationError = t('sig_required'); return false; }
      return true;
    }
    if (screen === 'details') {
      state.name = $('#fieldName').value.trim();
      state.dob = $('#fieldDob').value;
      state.gender = $('#fieldGender').value;
      state.email = $('#fieldEmail').value.trim();
      // Country code + what was typed. Composing it here is what stops a bare
      // number reaching the API, which refuses it as missing_country_code.
      state.phone = fullNumber('fieldPhone');
      state.whatsapp = fullNumber('fieldWhatsapp');
      if (!state.name || !state.phone || !state.whatsapp) return false;
      const err = phoneError(state.whatsapp) || phoneError(state.phone);
      if (err) { state.validationError = err; return false; }
      return true;
    }
    if (screen === 'slot') {
      state.timeNote = $('#fieldTimeNote').value.trim();
      return state.date && (state.slot || state.timeNote);
    }
    return true;
  }

  // ---------- grid ----------
  function iconFor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('ease')) return '🌿';
    if (n.includes('flex')) return '🤸';
    if (n.includes('relief')) return '💆';
    if (n.includes('release')) return '🧘';
    return '🌸';
  }

  function renderTherapies() {
    const grid = $('#therapyGrid');
    grid.innerHTML = '';
    if (!state.therapies.length) {
      grid.innerHTML = `<p class="empty">${t('therapy_none')}</p>`;
      return;
    }
    state.therapies.forEach((th) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tcard';
      card.innerHTML = `
        <span class="tcard__media${th.image_url ? '' : ' tcard__media--plain'}"${th.image_url ? ` style="background-image:url('${encodeURI(th.image_url)}')"` : ''}>
          ${th.duration_min ? `<span class="tcard__dur">${th.duration_min}<small>${t('min_word')}</small></span>` : ''}
          ${th.image_url ? '' : `<span class="tcard__emoji" aria-hidden="true">${iconFor(th.name)}</span>`}
          <span class="tcard__name">${escapeHtml(th.name)}</span>
        </span>
        <span class="tcard__foot">
          <span class="tcard__desc">${escapeHtml(stripHtml(th.tagline || th.description))}</span>
          <span class="tcard__row">
            <span class="tcard__from">${th.from_price ? `${t('from_word')} ${fmtPrice(th.from_price)}` : ''}</span>
            <span class="tcard__chev" aria-hidden="true">›</span>
          </span>
        </span>`;
      card.addEventListener('click', () => openTherapy(th.id));
      grid.appendChild(card);
    });
  }

  function openTherapy(id) {
    state.currentTherapyId = id;
    state.selectedPackageId = null;
    showScreen('therapy');
  }

  // ---------- therapy detail + package radio ----------
  function infoRow(icon, key, value) {
    if (!value) return '';
    return `<li class="infolist__row">
      <span class="infolist__ic" aria-hidden="true">${icon}</span>
      <span class="infolist__k">${escapeHtml(t(key))}</span>
      <span class="infolist__v">${escapeHtml(value)}</span>
    </li>`;
  }

  function renderTherapyDetail() {
    const th = currentTherapy();
    if (!th) return;
    const banner = $('#therapyBanner');
    const dur = th.duration_min ? `${th.duration_min} ${t('minutes_word')}` : '';
    banner.innerHTML = `
      ${th.image_url ? `<div class="therapy-banner__media"><img src="${escapeHtml(th.image_url)}" alt=""></div>` : ''}
      <h2 class="therapy-banner__name">${escapeHtml(therapyTitle(th))}</h2>
      ${th.description ? `<div class="therapy-banner__desc rich">${th.description}</div>` : (th.tagline ? `<p class="therapy-banner__desc">${escapeHtml(th.tagline)}</p>` : '')}
      <ul class="infolist">
        ${infoRow('⏱', 'info_duration', dur)}
        ${infoRow('👤', 'info_ideal', th.ideal_for)}
        ${infoRow('🎯', 'info_focus', th.focus_areas)}
      </ul>
      <p class="select-hint">${escapeHtml(t('select_package_hint'))} ⌄</p>`;

    renderPackages(th);
    updateViewDetailsBtn();
  }

  function renderPackages(th) {
    const list = $('#packageList');
    list.innerHTML = '';
    if (!th.packages.length) {
      list.innerHTML = `<p class="empty">${t('packages_none')}</p>`;
      return;
    }
    th.packages.forEach((p) => {
      const selected = state.selectedPackageId === p.id;
      const row = document.createElement('label');
      row.className = 'prow';
      row.classList.toggle('is-selected', selected);
      const freeTxt = p.session_count ? `${p.session_count} ${t('sessions_word')}` : '';
      row.innerHTML = `
        <input type="radio" name="pkg" value="${p.id}" ${selected ? 'checked' : ''}>
        <span class="prow__radio" aria-hidden="true"></span>
        <span class="prow__body">
          <span class="prow__name">${escapeHtml(p.name)}</span>
          ${freeTxt ? `<span class="prow__sub">${escapeHtml(freeTxt)}</span>` : ''}
        </span>
        <span class="prow__price">
          <span class="prow__amt">${fmtPrice(p.price)}</span>
          ${p.save ? `<span class="prow__save">${t('save_word')} ${fmtPrice(p.save)}</span>` : ''}
        </span>`;
      row.querySelector('input').addEventListener('change', () => {
        state.selectedPackageId = p.id;
        $$('#packageList .prow').forEach(r => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
        updateViewDetailsBtn();
      });
      list.appendChild(row);
    });
  }

  function updateViewDetailsBtn() {
    $('#btnViewDetails').disabled = !state.selectedPackageId;
  }
  $('#btnViewDetails').addEventListener('click', () => {
    if (state.selectedPackageId) showScreen('package');
  });

  // ---------- package details ----------
  function renderPackageDetail() {
    const th = currentTherapy();
    const p = selectedPackage();
    if (!p) return;
    const dur = p.duration_minutes ? `${p.duration_minutes} ${t('minutes_word')}` : '';
    const sessions = p.session_count ? `${p.session_count} ${t('sessions_word')}` : '';

    const detailsHtml = (p.details || []).map(d => `
      <div class="pkg-detail">
        ${d.image_url ? `<img class="pkg-detail__img" src="${escapeHtml(d.image_url)}" alt="" loading="lazy">` : ''}
        ${d.heading ? `<h5 class="pkg-detail__heading">${escapeHtml(d.heading)}</h5>` : ''}
        ${d.subheading ? `<p class="pkg-detail__sub">${escapeHtml(d.subheading)}</p>` : ''}
        ${d.description ? `<div class="rich">${d.description}</div>` : ''}
        ${(d.photos && d.photos.length) ? `<div class="pkg-detail__gallery">${d.photos.map(ph =>
          `<figure><img src="${escapeHtml(ph.url)}" alt="" loading="lazy">${ph.caption ? `<figcaption>${escapeHtml(ph.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
      </div>`).join('');

    $('#packageDetail').innerHTML = `
      <div class="pdetail__head">
        <h2 class="pdetail__name">${escapeHtml(p.name)}</h2>
        <span class="pdetail__price">${fmtPrice(p.price)}</span>
      </div>
      ${sessions ? `<p class="pdetail__sub">${escapeHtml(sessions)}${dur ? ` (${escapeHtml(dur)})` : ''}</p>` : ''}
      ${p.session_desc ? `<h4 class="section-h">${t('desc_word')}</h4><p class="pdetail__desc">${escapeHtml(p.session_desc)}</p>` : ''}
      <ul class="infolist">
        ${infoRow('🔁', 'info_sessions', sessions)}
        ${infoRow('⏱', 'info_duration', dur)}
        ${infoRow('👤', 'info_ideal', th ? th.ideal_for : '')}
        ${infoRow('🎯', 'info_focus', th ? th.focus_areas : '')}
      </ul>
      ${detailsHtml ? `<div class="pkg-detail-wrap">${detailsHtml}</div>` : ''}`;
  }

  // ---------- questions (rendered by type) ----------
  async function ensureQuestions() {
    if (state.questionsFor === state.selectedPackageId) {
      renderQuestions();
      return;
    }
    const list = $('#questionsList');
    list.innerHTML = `<p class="hint">${t('slots_loading')}</p>`;
    try {
      const { questions } = await data.getQuestions([state.selectedPackageId]);
      state.questions = questions || [];
      state.questionsFor = state.selectedPackageId;
      renderQuestions();
    } catch (e) {
      list.innerHTML = `<p class="hint">${t('questions_load_error')}</p>`;
    }
  }

  function renderQuestions() {
    const list = $('#questionsList');
    list.innerHTML = '';
    if (!state.questions.length) {
      list.innerHTML = `<p class="hint">${t('questions_none')}</p>`;
      return;
    }
    // The server hands the questions over already grouped, so a section
    // title only has to be printed where the heading changes - and the
    // numbering starts again underneath it.
    let section = null;
    let num = 0;
    state.questions.forEach((q) => {
      const id = q.heading_id || 0;
      if (id !== section) {
        section = id;
        num = 0;
        if (q.heading) {
          const title = document.createElement('p');
          title.className = 'q-heading';
          title.textContent = q.heading;
          // Colour / bold / italic / underline as set on the heading itself.
          title.style.cssText = q.heading_style || '';
          list.appendChild(title);
        }
      }
      num += 1;
      const wrap = document.createElement('div');
      wrap.className = 'question';
      const label = `<p class="question__label">${num}. ${escapeHtml(q.text)}${q.required ? ' <span class="req">*</span>' : ''}</p>`;
      wrap.innerHTML = label + questionInput(q);
      list.appendChild(wrap);
      wireQuestion(wrap, q);
    });
  }

  function questionInput(q) {
    const val = state.answers[q.id];
    const opts = q.options || [];
    if (q.type === 'yes_no') {
      return `<div class="q-choices q-choices--inline">
        ${['Yes', 'No'].map(o => `<label class="q-opt"><input type="radio" name="q_${q.id}" value="${o}" ${val === o ? 'checked' : ''}><span>${t(o === 'Yes' ? 'yes_word' : 'no_word')}</span></label>`).join('')}
      </div>`;
    }
    if (q.type === 'single_choice') {
      return `<select class="q-select" data-qid="${q.id}">
        <option value="" ${!val ? 'selected' : ''} disabled>${escapeHtml(t('choose_word'))}</option>
        ${opts.map(o => `<option value="${escapeHtml(o)}" ${val === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>`;
    }
    if (q.type === 'multi_choice') {
      const arr = Array.isArray(val) ? val : [];
      return `<div class="q-choices">
        ${opts.map(o => `<label class="q-opt q-opt--check"><input type="checkbox" value="${escapeHtml(o)}" ${arr.includes(o) ? 'checked' : ''}><span>${escapeHtml(o)}</span></label>`).join('')}
      </div>`;
    }
    // free text
    return `<textarea class="q-text" data-qid="${q.id}" rows="2" placeholder="${escapeHtml(t('questions_placeholder'))}">${escapeHtml(val || '')}</textarea>`;
  }

  function wireQuestion(wrap, q) {
    if (q.type === 'yes_no') {
      wrap.querySelectorAll(`input[name="q_${q.id}"]`).forEach(r =>
        r.addEventListener('change', e => { state.answers[q.id] = e.target.value; }));
    } else if (q.type === 'single_choice') {
      wrap.querySelector('select').addEventListener('change', e => { state.answers[q.id] = e.target.value; });
    } else if (q.type === 'multi_choice') {
      wrap.querySelectorAll('input[type="checkbox"]').forEach(cb =>
        cb.addEventListener('change', () => {
          const picked = Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(x => x.value);
          state.answers[q.id] = picked;
        }));
    } else {
      wrap.querySelector('textarea').addEventListener('input', e => { state.answers[q.id] = e.target.value; });
    }
  }

  // ---------- slots ----------
  $('#fieldDate').addEventListener('change', loadSlots);
  async function loadSlots() {
    const grid = $('#slotsList');
    state.date = $('#fieldDate').value;
    state.slot = null;
    if (!state.date || !state.selectedPackageId) return;
    grid.innerHTML = `<p class="hint">${t('slots_loading')}</p>`;
    try {
      const { slots } = await data.getAvailability([state.selectedPackageId], state.date);
      grid.innerHTML = '';
      if (!slots.length) { grid.innerHTML = `<p class="empty">${t('slots_empty')}</p>`; return; }
      slots.forEach((time) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = time;
        btn.addEventListener('click', () => {
          grid.querySelectorAll('button').forEach(b => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          state.slot = time;
        });
        grid.appendChild(btn);
      });
    } catch (e) {
      grid.innerHTML = `<p class="hint">${t('slots_error')}</p>`;
    }
  }

  // ---------- review ----------
  function answerDisplay(q) {
    const a = state.answers[q.id];
    if (Array.isArray(a)) return a.join(', ');
    if (q.type === 'yes_no' && a) return t(a === 'Yes' ? 'yes_word' : 'no_word');
    return a || '';
  }
  function renderReview() {
    const th = currentTherapy();
    const p = selectedPackage();
    const dl = $('#reviewList');
    const answersHtml = state.questions
      .filter(q => answerDisplay(q))
      .map(q => `<div><dt>${escapeHtml(q.text)}</dt><dd>${escapeHtml(answerDisplay(q))}</dd></div>`)
      .join('');
    dl.innerHTML = `
      <div><dt>${t('review_services')}</dt><dd>${escapeHtml(th ? therapyTitle(th) : '')}<br><strong>${escapeHtml(p ? p.name : '')}</strong> — ${fmtPrice(p ? p.price : 0)}</dd></div>
      <div><dt>${t('review_name')}</dt><dd>${escapeHtml(state.name)}</dd></div>
      <div><dt>${t('review_phone')}</dt><dd>${escapeHtml(state.phone)}</dd></div>
      <div><dt>${t('review_whatsapp')}</dt><dd>${escapeHtml(state.whatsapp)}</dd></div>
      ${state.email ? `<div><dt>${t('field_email')}</dt><dd>${escapeHtml(state.email)}</dd></div>` : ''}
      <div><dt>${t('review_date')}</dt><dd>${escapeHtml(state.date || '')}</dd></div>
      <div><dt>${t('review_time')}</dt><dd>${escapeHtml(state.slot || state.timeNote || '')}</dd></div>
      ${answersHtml}`;
  }

  // ---------- details: mobile == whatsapp ----------
  $('#fieldDob').addEventListener('change', () => setAge($('#fieldDob').value));

  // The tick promises ONE number, so the country code has to travel with
  // the digits - and the mobile's own country button has to stop being
  // clickable, or it can be changed back out of step a moment later.
  function mirrorWhatsappToPhone() {
    const same = $('#fieldSameNumber').checked;
    const phoneField = $('#fieldPhone');
    const ccButton = document.querySelector('.pc[data-for="fieldPhone"] .pc__cc');
    phoneField.readOnly = same;
    if (ccButton) { ccButton.disabled = same; }
    if (!same) { return; }
    phoneField.value = $('#fieldWhatsapp').value;
    state.dialCodes.fieldPhone = state.dialCodes.fieldWhatsapp;
    paintCountry('fieldPhone');
  }

  $('#fieldSameNumber').addEventListener('change', mirrorWhatsappToPhone);
  $('#fieldWhatsapp').addEventListener('input', mirrorWhatsappToPhone);

  // ---------- details: who is this number? ----------
  // Same "type the number first" flow as the POS Book Therapy screen: the
  // number identifies a returning customer and the rest of the form fills
  // itself in. A number is often shared by a whole family, so a match is never
  // assumed - the customer says which of them they are.
  const sig = { data: '', onFile: false, drawn: false, ctx: null };

  function setAge(dobValue) {
    const el = $('#fieldAge');
    const d = dobValue ? new Date(dobValue) : null;
    if (!d || isNaN(d.getTime())) { el.value = ''; return; }
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    el.value = (age >= 0 && age < 130) ? age : '';
  }

  function debounce(fn, ms) {
    let h;
    return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); };
  }

  function showSignatureOnFile(onFile) {
    sig.onFile = !!onFile;
    $('#sigOnFile').hidden = !onFile;
    $('#sigCapture').hidden = !!onFile;
    if (onFile) sig.data = '';
  }

  function clearIdentity() {
    $('#fieldEmail').value = '';
    $('#fieldName').value = '';
    $('#fieldDob').value = '';
    $('#fieldGender').value = '';
    setAge('');
    state.partnerId = null;
    showSignatureOnFile(false);
  }

  function fillFrom(c) {
    state.partnerId = c.id;
    $('#fieldName').value = c.name || '';
    $('#fieldDob').value = c.date_of_birth || '';
    $('#fieldGender').value = c.gender || '';
    setAge(c.date_of_birth || '');
    // Nothing about an earlier signature is fetched or reused: a signature is
    // consent to THIS service, so it is always drawn again on the questions
    // step, whoever the customer turns out to be.
    renderMatch();
  }

  function renderMatch() {
    const list = state.matches || [];
    const picked = list.find(c => c.id === state.partnerId) || null;
    $('#matchPanel').hidden = !(state.lookupBusy || state.lookupDone);
    $('#matchBusy').hidden = !state.lookupBusy;
    $('#matchChip').hidden = !(picked && !state.lookupBusy);
    if (picked) $('#matchChipName').textContent = picked.name;
    $('#matchNone').hidden =
      state.lookupBusy || !state.lookupDone || list.length > 0 || state.newOnNumber;
    const listEl = $('#matchList');
    listEl.hidden = state.lookupBusy || !!picked || !list.length || state.newOnNumber;
    if (!listEl.hidden) {
      listEl.innerHTML = '';
      list.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'match__item';
        b.textContent = c.name;
        b.addEventListener('click', () => fillFrom(c));
        listEl.appendChild(b);
      });
    }
    $('#btnNewOnNumber').hidden = state.lookupBusy || !list.length || state.newOnNumber;
  }

  const lookupCustomer = debounce(async () => {
    const number = $('#fieldWhatsapp').value.trim();
    if (number.replace(/\D/g, '').length < 8) {
      state.matches = []; state.lookupDone = false; state.lookupBusy = false;
      renderMatch();
      return;
    }
    state.lookupBusy = true;
    renderMatch();
    try {
      const res = await data.lookupCustomer(state.token, number);
      // The number may have changed while the request was in flight.
      if ($('#fieldWhatsapp').value.trim() !== number) return;
      state.matches = (res && res.customers) || [];
      state.lookupDone = true;
      // Exactly one person: fill it in. Several: let them choose, because a
      // number is often shared by a whole family.
      if (state.matches.length === 1) fillFrom(state.matches[0]);
    } catch (e) {
      state.matches = []; state.lookupDone = true;
    } finally {
      state.lookupBusy = false;
      renderMatch();
    }
  }, 400);

  $('#fieldWhatsapp').addEventListener('input', () => {
    // Anything auto-filled belongs to the PREVIOUS number - drop it, or the
    // booking is saved under the wrong person.
    if (state.partnerId) clearIdentity();
    state.matches = []; state.lookupDone = false; state.newOnNumber = false;
    renderMatch();
    lookupCustomer();
  });
  $('#btnNotMe').addEventListener('click', () => {
    clearIdentity(); state.newOnNumber = false; renderMatch();
  });
  $('#btnNewOnNumber').addEventListener('click', () => {
    clearIdentity(); state.newOnNumber = true; renderMatch();
  });
  $('#btnSignAgain').addEventListener('click', () => {
    showSignatureOnFile(false);
    setupPad();
  });

  // ---------- details: signature ----------
  // A canvas kept at its default 300x150 backing store draws the strokes badly
  // offset from the finger, so size it to the box (times the device pixel
  // ratio) every time the screen is shown.
  function setupPad() {
    const el = $('#sigPad');
    if (!el || $('#sigCapture').hidden) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;              // still hidden
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f1720';
    sig.ctx = ctx;
    sig.drawn = false;
    if (sig.data) {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(w / img.width, h / img.height, 1);
        ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2,
          img.width * s, img.height * s);
        sig.drawn = true;
      };
      img.src = 'data:image/png;base64,' + sig.data;
    }
  }

  (function bindSignaturePad() {
    const el = $('#sigPad');
    if (!el) return;
    let drawing = false;
    const point = (ev) => {
      const r = el.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    el.addEventListener('pointerdown', (ev) => {
      if (!sig.ctx) setupPad();
      if (!sig.ctx) return;
      ev.preventDefault();
      // A finger easily slides off the box mid-stroke; without capture the
      // stroke just stops there.
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* already ended */ }
      drawing = true;
      const p = point(ev);
      sig.ctx.beginPath();
      sig.ctx.moveTo(p.x, p.y);
    });
    el.addEventListener('pointermove', (ev) => {
      if (!drawing || !sig.ctx) return;
      ev.preventDefault();
      const p = point(ev);
      sig.ctx.lineTo(p.x, p.y);
      sig.ctx.stroke();
      sig.drawn = true;
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      if (sig.drawn) sig.data = el.toDataURL('image/png').split(',')[1] || '';
      $('#sigError').hidden = true;
    };
    ['pointerup', 'pointercancel', 'pointerleave']
      .forEach(name => el.addEventListener(name, end));
  })();

  $('#btnSigClear').addEventListener('click', () => {
    sig.data = '';
    setupPad();
    $('#sigError').hidden = true;
  });

  $('#sigFile').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';          // so picking the same file again still fires
    const err = $('#sigError');
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      err.textContent = t('sig_err_type'); err.hidden = false; return;
    }
    if (file.size > 2 * 1024 * 1024) {
      err.textContent = t('sig_err_big'); err.hidden = false; return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      sig.data = String(reader.result || '').split(',')[1] || '';
      err.hidden = true;
      setupPad();                  // paint it into the box so they can see it
    };
    reader.onerror = () => { err.textContent = t('sig_err_read'); err.hidden = false; };
    reader.readAsDataURL(file);
  });

  // ---------- phone country picker ----------
  function fullNumber(inputId) {
    const digits = ($('#' + inputId).value || '').replace(/\D/g, '');
    return digits ? (state.dialCodes[inputId] || DEFAULT_DIAL_CODE) + digits : '';
  }

  // Split a stored E.164 back into country + local, so a number we already
  // hold reopens with the right flag instead of the whole string in the box.
  function setNumber(inputId, full) {
    const value = String(full || '').trim().replace(/[^\d+]/g, '');
    let code = DEFAULT_DIAL_CODE;
    let local = value.replace(/^\+/, '');
    if (value.startsWith('+')) {
      const match = [...COUNTRIES]
        .sort((a, b) => b.code.length - a.code.length)
        .find(c => value.startsWith(c.code));
      if (match) { code = match.code; local = value.slice(match.code.length); }
    }
    state.dialCodes[inputId] = code;
    $('#' + inputId).value = local;
    paintCountry(inputId);
  }

  function paintCountry(inputId) {
    const pc = document.querySelector(`.pc[data-for="${inputId}"]`);
    if (!pc) return;
    const code = state.dialCodes[inputId] || DEFAULT_DIAL_CODE;
    const c = COUNTRIES.find(x => x.code === code) || COUNTRIES[0];
    pc.querySelector('.pc__flag').textContent = c.flag;
    pc.querySelector('.pc__code').textContent = c.code;
  }

  function bindCountryPicker(inputId) {
    const pc = document.querySelector(`.pc[data-for="${inputId}"]`);
    if (!pc) return;
    const menu = pc.querySelector('.pc__menu');
    const toggle = pc.querySelector('.pc__cc');
    menu.innerHTML = COUNTRIES.map(c => `
      <button type="button" class="pc__opt" role="option" data-code="${c.code}">
        <span class="pc__flag">${c.flag}</span><span>${escapeHtml(c.name)}</span>
        <span class="pc__opt-code">${c.code}</span>
      </button>`).join('');
    toggle.addEventListener('click', () => {
      const open = menu.hidden;
      // Only one menu open at a time.
      document.querySelectorAll('.pc__menu').forEach(m => { m.hidden = true; });
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', (ev) => {
      const opt = ev.target.closest('.pc__opt');
      if (!opt) return;
      state.dialCodes[inputId] = opt.dataset.code;
      paintCountry(inputId);
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      // The country is part of the number, so anything watching it re-runs.
      $('#' + inputId).dispatchEvent(new Event('input', { bubbles: true }));
    });
    paintCountry(inputId);
  }

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.pc')) {
      document.querySelectorAll('.pc__menu').forEach(m => { m.hidden = true; });
    }
  });

  ['fieldWhatsapp', 'fieldPhone'].forEach(bindCountryPicker);

  function phoneError(value) {
    const val = (value || '').trim();
    if (!val.startsWith('+')) return 'err_phone_country_code';
    const digits = val.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return 'err_phone_invalid';
    return null;
  }

  // ---------- submit ----------
  async function submitBooking() {
    const btn = $('[data-screen="review"] .js-next');
    btn.disabled = true;
    btn.textContent = t('btn_submitting');
    try {
      // Flatten answers to strings the backend stores as value_text.
      const answersOut = {};
      Object.keys(state.answers).forEach(qid => {
        const a = state.answers[qid];
        answersOut[qid] = Array.isArray(a) ? a.join(', ') : (a || '');
      });
      const res = await data.submitBooking({
        token: state.token,
        name: state.name, phone: state.phone, whatsapp: state.whatsapp,
        email: state.email || '',
        date_of_birth: state.dob || '', gender: state.gender || '',
        signature: sig.data || '',
        terms_accepted: !!state.terms,
        service_ids: [state.selectedPackageId],
        answers: answersOut,
        slot_datetime: `${state.date} ${state.slot || '00:00'}`,
        time_note: state.timeNote || '',
      });
      renderConfirm(res);
      $$('.screen').forEach(s => s.classList.remove('is-active'));
      $('[data-screen="done"]').classList.add('is-active');
      $('#appbar').hidden = true;
      $('#railList').closest('.rail').style.display = 'none';
    } catch (e) {
      let msgKey = 'err_submit_failed';
      const code = e.data && e.data.error;
      if (code === 'invalid_phone') {
        msgKey = e.data.reason === 'missing_country_code' ? 'err_phone_country_code' : 'err_phone_invalid';
      } else if (code === 'already_booked') {
        msgKey = 'err_already_booked';
      } else if (e.status === 410) {
        // The link itself is unusable - don't blame the customer's details.
        msgKey = 'err_invalid_link';
      }
      showBanner(t(msgKey));
      btn.disabled = false;
      btn.textContent = t('btn_confirm');
    }
  }

  function renderConfirm(res) {
    const th = currentTherapy();
    const p = selectedPackage();
    $('#confirmSummary').innerHTML = `
      <div class="confirm-summary__card">
        <span class="confirm-summary__k">${escapeHtml(t('selected_package'))}</span>
        <span class="confirm-summary__v">${escapeHtml(th ? therapyTitle(th) : '')} — <strong>${escapeHtml(p ? p.name : '')}</strong></span>
        <span class="confirm-summary__price">${fmtPrice(p ? p.price : 0)}</span>
        ${res && res.booking_ref ? `<span class="confirm-summary__ref">${escapeHtml(t('ref_word'))}: ${escapeHtml(res.booking_ref)}</span>` : ''}
      </div>`;
  }

  // ---------- wiring ----------
  $('#btnBack').addEventListener('click', back);
  $$('.js-next').forEach(b => b.addEventListener('click', advance));

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html == null ? '' : String(html);
    return (div.textContent || '').trim();
  }

  document.addEventListener('languagechange', async () => {
    // Re-fetch the catalogue in the new language (translatable content:
    // names, descriptions, ideal-for, focus-areas, questions).
    try {
      const res = await data.getTherapies();
      if (res && res.therapies) {
        state.therapies = res.therapies;
        if (res.currency) state.currency = res.currency;
      }
    } catch (e) { /* keep current content on failure */ }
    state.questionsFor = null; // force questions to reload translated

    if (state.screen === 'grid') renderTherapies();
    if (state.screen === 'therapy') renderTherapyDetail();
    if (state.screen === 'package') renderPackageDetail();
    if (state.screen === 'questions') await ensureQuestions();
    if (state.screen === 'review') renderReview();
    // refresh appbar title in the new language
    if (!$('#appbar').hidden) {
      const th = currentTherapy(); const pkg = selectedPackage();
      let title = therapyTitle(th);
      if (pkg && ['questions', 'details', 'slot', 'review'].includes(state.screen)) title += ` • ${pkg.name}`;
      $('#appbarTitle').textContent = title;
    }
  });

  init();
})();
