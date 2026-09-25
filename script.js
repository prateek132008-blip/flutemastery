/* ============================================================
   FLUTE MASTERY — script.js  (v4 — reliable payments + recovery)
   Handles: Enrollment Modals, Nav, FAQ, Razorpay, Meta Pixel,
            Google Apps Script (ONE script: "All Course Data"),
            Payment recovery (floating button + popup), Scroll Animations
   ============================================================ */

'use strict';

/* ── CONFIGURATION — the only place to edit ────────────────── */
var RAZORPAY_KEY_ID   = 'rzp_live_Sczvk68iCuryMo';   // PUBLIC key only — the secret lives in Google Script properties
var COURSE_AMOUNT     = 79900;                         // paise (₹799)
var COURSE_NAME       = 'Flute Mastery — Complete Course';
var BUSINESS_NAME     = 'Flute Mastery';
var LOGO_URL          = '';
var WHATSAPP_NUM      = '918709268496';
var THANKYOU_URL      = 'thankyou.html';
var PIXEL_ID          = '1001951225815875';

/*
  ONE Google Apps Script Web App URL for the whole site ("All Course Data").
  Replaces the 3 old per-course script URLs. After deploying the new script
  (Google script/All-Course-Data-Code.gs), paste its /exec URL here.
*/
var GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwm9vuxx11NV94XGBkHfqEZK6IimrgQsSQxHp0fDoxCLppWUNMvHBNDLepEYXihBHfm8Q/exec';

/* Products — prices must match PRODUCTS in the Google Script. */
var PRODUCTS = {
  beginner: {
    key: 'beginner', name: COURSE_NAME, shortName: 'Beginner',
    amountPaise: 79900, price: 799, originalPrice: 2499, thankyouUrl: 'thankyou.html',
  },
  advanced: {
    key: 'advanced', name: 'Advanced Flute Mastery', shortName: 'Advanced',
    amountPaise: 99900, price: 999, originalPrice: 3999, thankyouUrl: 'thankyou-advanced.html',
  },
  bundle: {
    key: 'bundle', name: 'Beginner + Advanced Flute Bundle', shortName: 'Bundle',
    amountPaise: 160100, price: 1601, originalPrice: 3498, thankyouUrl: 'thankyou-bundle.html',
  },
};

/* ── PAYMENT RECOVERY — manual UPI details (the ONLY place to change them) ──
   QR image → replace the file assets/upi-qr.png (keep the name).
   Public details only — no secret keys belong here. */
var PAYMENT_RECOVERY = {
  QR_IMAGE:              'assets/upi-qr.png',
  UPI_ID:                'prateekjha@fam',
  WHATSAPP_NUMBER:       '918709268496',     // country code + number, no + or spaces
  SUPPORT_PHONE_DISPLAY: '+91 8709268496',
  SUPPORT_PHONE_TEL:     '+918709268496',

  // Option 3 — "Pay to Phone Number" (any UPI app → Pay to phone number).
  // Enter the 10-digit number linked to the account below. Leave '' to hide Option 3.
  PAY_PHONE_NUMBER:      '',
  PAY_PHONE_NAME:        'NIDHI JHA',        // name customers will see in their UPI app
};

/* ── Meta Pixel Helper ─────────────────────────────────────── */
/* CAPI FIX: optional 3rd "options" param so callers can pass
   { eventID: '...' } for Browser↔Server de-duplication.
   v4: wrapped in try/catch — a broken/blocked Pixel can never stop a
   popup or the payment window from opening. */
function fbqTrack(event, data, options) {
  try {
    if (typeof fbq === 'function') fbq('track', event, data || {}, options || {});
  } catch (e) { console.warn('[Pixel] ignored error:', e); }
}

/* ── Meta Manual Advanced Matching Helper ──────────────────────
   Automatic Advanced Matching can only pick up data already sitting
   in visible page fields. Our own enrollment form/checkout data is
   more reliable, so we push it in manually by re-calling fbq('init', ...)
   with a user-data object once we have it. The Pixel SDK normalizes
   and SHA-256 hashes em/ph/fn/ln itself — plain values are correct here.
   This does not replace Automatic Advanced Matching, it supplements it. */
function normalizePhoneForMatching(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits; // assume Indian number, add country code
  return digits;
}

function setPixelAdvancedMatching(user) {
  if (typeof fbq !== 'function' || !user) return;
  var nameParts = String(user.name || '').trim().split(/\s+/).filter(Boolean);
  var fn = nameParts[0] || '';
  var ln = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  fbq('init', PIXEL_ID, {
    em:      (user.email || '').trim().toLowerCase(),
    ph:      normalizePhoneForMatching(user.phone),
    fn:      fn,
    ln:      ln,
    country: 'in',
  });
}

/* Reads a cookie value by name — used to forward _fbp/_fbc to our
   server so the CAPI Purchase event can include them for matching. */
function getCookie(name) {
  var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

/* ============================================================
   CHECKOUT CORE (v4) — one shared flow for Beginner, Advanced
   and Bundle. What changed vs v3 (see audit):
   - A real Razorpay ORDER is created by the Google Script, but it
     is PRE-FETCHED the moment the details popup opens, so Submit
     normally opens Razorpay instantly. If the order isn't ready
     within ORDER_GRACE_MS (same 1.2 s ceiling the old Sheet write
     had), Razorpay opens WITHOUT it — the server still verifies
     and captures that payment. Google can never block payment.
   - The Sheet "Pending" save is fire-and-forget (sendBeacon) and
     is never waited for.
   - The details popup stays open with a countdown on its button
     until Razorpay has actually opened (before, it closed first and
     the page could look frozen for up to 8 s while Razorpay loaded).
   - No alert() popups. A failed payment stays inside Razorpay's own
     window (its native retry); the floating "Payment failed? — Pay
     here" button is the permanent recovery path.
   - Payment success is only a HINT to the server, which verifies it
     with Razorpay before giving access or recording the sale.
   - Recovery: if the page is reloaded/killed while the customer is in
     a UPI app, or Razorpay's "processing" screen hangs, the site asks
     the server whether the order was paid and continues if it was.
   ============================================================ */

/* ── CHECKOUT FIX #1 — Razorpay SDK readiness guard (unchanged) ── */
var RAZORPAY_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';
var _rzpInjected = false;

function ensureRazorpayReady(onReady, onFail) {
  if (typeof Razorpay !== 'undefined') { onReady(); return; }

  if (!_rzpInjected) {
    _rzpInjected = true;
    var s = document.createElement('script');
    s.src = RAZORPAY_SDK_URL;
    s.async = true;
    document.head.appendChild(s);
  }

  var waited = 0;
  var poll = setInterval(function () {
    if (typeof Razorpay !== 'undefined') {
      clearInterval(poll);
      onReady();
      return;
    }
    waited += 200;
    if (waited >= 8000) {          // hard ceiling — never spin forever
      clearInterval(poll);
      onFail();
    }
  }, 200);
}

/* CHECKOUT FIX #2 — never allow two checkout instances at once. */
var _checkoutOpen     = false;  // Razorpay window is open
var _checkoutStarting = false;  // between Submit and Razorpay opening (blocks double-clicks)
var _purchaseDone     = false;  // redirecting to the thank-you page
var _rzp              = null;
var _currentKey       = '';
var _lastCheckout     = null;   // { productKey, data } — used by "Retry Payment"

var ORDER_GRACE_MS     = 1200;
var ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* ── Small safe helpers ───────────────────────────────────── */
function safeGet_(area, key) { try { return window[area].getItem(key); } catch (e) { return null; } }
function safeSet_(area, key, v) { try { window[area].setItem(key, v); } catch (e) { /* ignore */ } }
function safeRemove_(area, key) { try { window[area].removeItem(key); } catch (e) { /* ignore */ } }

function isScriptConfigured() {
  return !!GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL.indexOf('PASTE_') === -1 && GOOGLE_SCRIPT_URL.indexOf('YOUR_SCRIPT_ID') === -1;
}
function scriptUrl_(params) {
  var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  return GOOGLE_SCRIPT_URL + '?' + q;
}
/* JSON request to the Google Script with a hard timeout — never hangs. */
function scriptGet_(params, timeoutMs) {
  if (!isScriptConfigured()) return Promise.reject(new Error('GOOGLE_SCRIPT_URL not configured'));
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 12000);
  return fetch(scriptUrl_(params), { method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { return r.json(); })
    .then(function (j) { clearTimeout(t); return j; }, function (err) { clearTimeout(t); throw err; });
}
/* Fire-and-forget POST (survives page navigation). Never throws, never waited for. */
function scriptBeacon_(data) {
  try {
    if (!isScriptConfigured()) { console.warn('[Sheet] GOOGLE_SCRIPT_URL not configured — skipping.'); return; }
    var payload = JSON.stringify(data);
    if (navigator.sendBeacon && navigator.sendBeacon(GOOGLE_SCRIPT_URL, new Blob([payload], { type: 'text/plain' }))) return;
    fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain' }, body: payload }).catch(function () { /* ignore */ });
  } catch (e) { /* never affect checkout */ }
}

/* ── Purchase attempt (one per product, reused on retry → no duplicate orders/rows) ── */
var _attempts = {};
var _orderPromises = {};

function newOrderRef_() {
  var r = '';
  try { var b = new Uint8Array(4); crypto.getRandomValues(b); r = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(36)).slice(-2); }).join(''); }
  catch (e) { r = Math.random().toString(36).slice(2, 10); }
  return ('FM-' + Date.now().toString(36) + '-' + r).toUpperCase();
}
function loadAttempt_(key) {
  if (_attempts[key]) return _attempts[key];
  try {
    var a = JSON.parse(safeGet_('localStorage', 'fm_attempt_' + key) || 'null');
    if (a && a.ref && Date.now() - (a.createdAt || 0) < ATTEMPT_MAX_AGE_MS) { _attempts[key] = a; return a; }
  } catch (e) { /* ignore */ }
  return null;
}
function getOrCreateAttempt_(key) {
  var a = loadAttempt_(key);
  if (!a) { a = { ref: newOrderRef_(), createdAt: Date.now() }; saveAttempt_(key, a); }
  return a;
}
function saveAttempt_(key, a) { _attempts[key] = a; safeSet_('localStorage', 'fm_attempt_' + key, JSON.stringify(a)); }
function clearAttempt_(key) { delete _attempts[key]; safeRemove_('localStorage', 'fm_attempt_' + key); }

function ensureOrder_(key) {
  var a = getOrCreateAttempt_(key);
  if (a.rzpOrderId) return Promise.resolve(a);
  if (_orderPromises[key]) return _orderPromises[key];
  _orderPromises[key] = scriptGet_({ action: 'createOrder', product: key, ref: a.ref }, 15000)
    .then(function (res) {
      if (!res || res.status !== 'ok' || !res.rzpOrderId) throw new Error('createOrder failed');
      a.rzpOrderId = res.rzpOrderId;
      if (res.ref) a.ref = res.ref;
      saveAttempt_(key, a);
      return a;
    });
  _orderPromises[key].then(function () { delete _orderPromises[key]; }, function () { delete _orderPromises[key]; });
  return _orderPromises[key];
}
/* Background pre-fetch when a details popup opens. */
function prefetchOrder_(key) { try { ensureOrder_(key).catch(function () { /* opens without order */ }); } catch (e) { /* ignore */ } }
/* Resolves with the attempt after at most `ms` — with an order if it is ready. Never rejects. */
function waitForOrder_(key, ms) {
  var a = getOrCreateAttempt_(key);
  if (a.rzpOrderId) return Promise.resolve(a);
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; resolve(getOrCreateAttempt_(key)); } }, ms);
    ensureOrder_(key).then(function (x) { if (!done) { done = true; clearTimeout(t); resolve(x); } },
                           function () { if (!done) { done = true; clearTimeout(t); resolve(getOrCreateAttempt_(key)); } });
  });
}

/* ── Visual-only button countdown: "Opening secure payment… 8s" ──
   NEVER controls Razorpay: it is stopped the moment Razorpay opens
   or the flow reports an error. */
var _cd = { btn: null, label: null, html: '', timer: null, n: 0 };
function startButtonCountdown_(btn) {
  try {
    stopButtonCountdown_();
    if (!btn) return;
    _cd.btn = btn;
    _cd.label = btn.querySelector('.btn-text') || btn;
    _cd.html = _cd.label.innerHTML;
    btn.classList.remove('loading');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    _cd.n = 8;
    var render = function () {
      _cd.label.textContent = _cd.n > 0 ? 'Opening secure payment… ' + _cd.n + 's' : 'Still opening payment…';
    };
    render();
    _cd.timer = setInterval(function () {
      if (_cd.n > 0) _cd.n--;
      render();
      if (_cd.n <= 0) { clearInterval(_cd.timer); _cd.timer = null; }
    }, 1000);
  } catch (e) { /* visual only */ }
}
function stopButtonCountdown_() {
  try {
    if (_cd.timer) { clearInterval(_cd.timer); _cd.timer = null; }
    if (_cd.btn) {
      _cd.label.innerHTML = _cd.html;
      _cd.btn.disabled = false;
      _cd.btn.removeAttribute('aria-busy');
    }
    _cd.btn = null; _cd.label = null;
  } catch (e) { /* visual only */ }
}

/* ── Start checkout (shared by every product) ─────────────────
   opts.button   → button that shows the countdown
   opts.onStatus → function(msg, isError) for inline messages
   opts.onOpened → called once Razorpay is on screen */
function startCheckout(productKey, data, opts) {
  opts = opts || {};
  var product = PRODUCTS[productKey];
  if (!product) return;
  if (_checkoutOpen || _checkoutStarting || _purchaseDone) return;   // no double clicks / stacked checkouts

  _checkoutStarting = true;
  _currentKey = productKey;
  _lastCheckout = { productKey: productKey, data: data };
  safeSet_('localStorage', 'fm_last_checkout', JSON.stringify({ productKey: productKey, data: data, at: Date.now() }));
  startButtonCountdown_(opts.button);
  if (opts.onStatus) opts.onStatus('', false);

  var attempt = getOrCreateAttempt_(productKey);
  attempt.customer = data;
  saveAttempt_(productKey, attempt);

  // Pending lead → Sheet. Fire-and-forget: never delays or blocks Razorpay.
  scriptBeacon_({
    type: 'lead', status: 'pending', product: productKey, orderRef: attempt.ref,
    name: data.name, email: data.email, phone: data.phone,
    amount: String(product.price), course: product.name,
    fbp: getCookie('_fbp'), fbc: getCookie('_fbc'), clientUserAgent: navigator.userAgent || ''
  });

  waitForOrder_(productKey, ORDER_GRACE_MS).then(function (a) {
    openRazorpay_(productKey, data, a, opts);
  });
}

function openRazorpay_(productKey, data, attempt, opts) {
  var product = PRODUCTS[productKey];
  var wasOpenedBefore = !!attempt.opened;

  function fail(msg) {
    _checkoutStarting = false;
    stopButtonCountdown_();
    if (opts.onStatus) opts.onStatus(msg, true);
  }

  ensureRazorpayReady(function () {
    try {
      var digits = String(data.phone || '').replace(/\D/g, '').slice(-10);
      var options = {
        key:         RAZORPAY_KEY_ID,
        amount:      product.amountPaise,
        currency:    'INR',
        name:        BUSINESS_NAME,
        description: product.name,
        image:       LOGO_URL,
        prefill: {
          name:    data.name  || '',
          email:   data.email || '',
          contact: digits.length === 10 ? '+91' + digits : (data.phone || '')
        },
        notes: {
          product_key:   productKey,
          product:       product.name,
          order_ref:     attempt.ref,
          customer_name: String(data.name || '').slice(0, 100),
          student_name:  data.name  || '',
          student_email: data.email || ''
        },
        theme: { color: '#C9922A' },
        modal: {
          ondismiss: function () {
            _checkoutOpen = false;
            if (_purchaseDone) return;
            console.log('[Razorpay] Checkout dismissed (' + productKey + ')');
            // A UPI payment can complete a little after the window is closed.
            if (attempt.rzpOrderId) startStatusPoll_(productKey, 5000, 120000);
          }
        },
        handler: function (response) {
          completePurchase_(productKey, {
            paymentId: response.razorpay_payment_id,
            rzpOrderId: response.razorpay_order_id || attempt.rzpOrderId || ''
          }, 'handler');
        }
      };
      if (attempt.rzpOrderId) options.order_id = attempt.rzpOrderId;

      _rzp = new Razorpay(options);
      _rzp.on('payment.failed', function (response) {
        // Razorpay keeps its own window open so the customer can try another
        // method (same order). No alert and no automatic popup.
        console.warn('[Razorpay] Payment failed (' + productKey + '):', response && response.error);
      });
      _rzp.open();
      _checkoutOpen = true;
      _checkoutStarting = false;
      attempt.opened = true;
      saveAttempt_(productKey, attempt);
      stopButtonCountdown_();
      if (opts.onOpened) opts.onOpened();

      // Retry safety: was this order already paid (e.g. UPI finished after
      // the window closed)? Checked in parallel — never delays the window.
      if (wasOpenedBefore && attempt.rzpOrderId) {
        scriptGet_({ action: 'status', rzpOrderId: attempt.rzpOrderId }, 10000).then(function (res) {
          if (res && res.status === 'paid') completePurchase_(productKey, { paymentId: res.paymentId, rzpOrderId: attempt.rzpOrderId }, 'recovered');
        }).catch(function () { /* ignore */ });
      }
    } catch (err) {
      _checkoutOpen = false;
      console.error('[Razorpay] Could not open checkout:', err);
      fail('We could not open the secure payment window. Please try again, or tap "Payment failed? — Pay here" to pay by UPI.');
    }
  }, function () {
    console.error('[Razorpay] checkout.js failed to load.');
    fail('The secure payment window could not load (common inside Instagram/Facebook). Tap ⋯ → "Open in Chrome", try again, or tap "Payment failed? — Pay here" to pay by UPI.');
  });
}

/* Single exit to the thank-you page. The server — not this code —
   decides whether the payment is real before giving access. */
function completePurchase_(productKey, info, via) {
  if (_purchaseDone || !info || !info.paymentId) return;
  _purchaseDone = true;
  stopStatusPoll_();
  if (via !== 'handler') { try { if (_rzp && _checkoutOpen) _rzp.close(); } catch (e) { /* ignore */ } }
  _checkoutOpen = false;

  var product = PRODUCTS[productKey];
  var a = loadAttempt_(productKey) || {};
  var c = a.customer || (_lastCheckout && _lastCheckout.data) || {};

  // Same sessionStorage keys the thank-you pages already read.
  var sfx = productKey === 'beginner' ? '' : '_' + productKey;
  safeSet_('sessionStorage', 'rzp_payment_id' + sfx,    info.paymentId);
  safeSet_('sessionStorage', 'rzp_student_name' + sfx,  c.name  || '');
  safeSet_('sessionStorage', 'rzp_student_email' + sfx, c.email || '');
  safeSet_('sessionStorage', 'rzp_student_phone' + sfx, c.phone || '');

  // Verification hint (sendBeacon survives the redirect). The server re-checks with Razorpay.
  scriptBeacon_({
    status: 'paid', paymentId: info.paymentId, orderId: info.rzpOrderId || '', orderRef: a.ref || '',
    product: productKey, fbp: getCookie('_fbp'), fbc: getCookie('_fbc'), clientUserAgent: navigator.userAgent || ''
  });
  clearAttempt_(productKey);
  safeRemove_('localStorage', 'fm_last_checkout');

  window.location.href = product.thankyouUrl + '?payment_id=' + encodeURIComponent(info.paymentId);
}

/* ── Recovery: ask the server (→ Razorpay) whether the order was paid ── */
var _pollTimer = null, _pollToken = 0;
function stopStatusPoll_() { _pollToken++; if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; } }
function startStatusPoll_(productKey, everyMs, forMs) {
  var a = loadAttempt_(productKey);
  if (!a || !a.rzpOrderId || _purchaseDone || !isScriptConfigured()) return;
  stopStatusPoll_();
  var token = _pollToken, started = Date.now();
  (function tick() {
    if (token !== _pollToken || _purchaseDone) return;
    scriptGet_({ action: 'status', rzpOrderId: a.rzpOrderId }, 12000)
      .then(function (res) {
        if (token === _pollToken && res && res.status === 'paid') {
          completePurchase_(productKey, { paymentId: res.paymentId, rzpOrderId: a.rzpOrderId }, 'recovered');
        }
      })
      .catch(function () { /* keep trying */ })
      .then(function () {
        if (token !== _pollToken || _purchaseDone) return;
        if (Date.now() - started < forMs) _pollTimer = setTimeout(tick, everyMs);
      });
  })();
}
// Back from the UPI/wallet app while Razorpay is open → check in parallel.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && _checkoutOpen && !_purchaseDone && _currentKey) {
    startStatusPoll_(_currentKey, 4000, 180000);
  }
});
// Page reloaded after checkout was opened (common when switching to a UPI app).
(function recoverOnLoad() {
  if (!document.querySelector('.modal-overlay[id^="enrollModal"]')) return; // sales pages only
  ['beginner', 'advanced', 'bundle'].forEach(function (key) {
    var a = loadAttempt_(key);
    if (a && a.opened && a.rzpOrderId) {
      scriptGet_({ action: 'status', rzpOrderId: a.rzpOrderId }, 12000).then(function (res) {
        if (res && res.status === 'paid') completePurchase_(key, { paymentId: res.paymentId, rzpOrderId: a.rzpOrderId }, 'recovered');
      }).catch(function () { /* ignore */ });
    }
  });
})();

/* Hides a details popup once Razorpay is on screen, KEEPING the typed
   details so "Retry Payment" doesn't make the customer re-type them. */
function hideOverlayKeepData_(overlayId) {
  var overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

/* ── Enrollment Modal ──────────────────────────────────────── */
/*
  The modal collects Name, Email, and WhatsApp before opening
  Razorpay. The "Pending" Sheet save is fire-and-forget (never waited
  for); the server marks the order paid only after verifying it.
*/

var _studentData = {}; // holds form data between modal → Razorpay


function openEnrollmentModal() {
  prefetchOrder_('beginner');   // v4: Razorpay order is ready before Submit
  fbqTrack('InitiateCheckout', {
    value: 799,
    currency: 'INR',
    content_name: COURSE_NAME,
    content_type: 'product',
  });
  var overlay = document.getElementById('enrollModal');
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(function () {
    var first = overlay.querySelector('input');
    if (first) first.focus();
  }, 300);
}

function closeEnrollmentModal() {
  var overlay = document.getElementById('enrollModal');
  if (!overlay) return;
  /* CHECKOUT FIX #5: this runs on every Escape keypress, page-wide.
     Previously it reset body{overflow} even when this modal was not
     open — including while the Razorpay checkout overlay was on
     screen, which let the page scroll behind the checkout and made
     it look broken/stuck. Now it only acts when it is actually the
     open modal. */
  if (!overlay.classList.contains('active')) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  resetModalForm();
}

function resetModalForm() {
  var form = document.getElementById('enrollForm');
  if (form) form.reset();
  clearFieldErrors();
  setModalStatus('', false);
  setModalSubmitLoading(false);
}

/* Keyboard: Escape closes any open modal overlay */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  closeEnrollmentModal();
  closeUdyamModal();
});

/* Click outside any modal box closes that modal */
document.addEventListener('click', function (e) {
  if (!e.target.classList || !e.target.classList.contains('modal-overlay')) return;
  if (e.target.id === 'enrollModal')   closeEnrollmentModal();
  if (e.target.id === 'udyamModal')    closeUdyamModal();
});

/* ── Form Validation ───────────────────────────────────────── */
function validateEnrollForm() {
  clearFieldErrors();
  var name    = (document.getElementById('enrollName')    || {}).value || '';
  var email   = (document.getElementById('enrollEmail')   || {}).value || '';
  var whatsapp= (document.getElementById('enrollWhatsapp')|| {}).value || '';
  var valid   = true;

  if (!name.trim() || name.trim().length < 2) {
    showFieldError('enrollName', 'Please enter your full name (at least 2 characters).');
    valid = false;
  }

  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.trim() || !emailRegex.test(email.trim())) {
    showFieldError('enrollEmail', 'Please enter a valid email address.');
    valid = false;
  }

  var phone = whatsapp.replace(/[\s\-\+\(\)]/g, '');
  if (!phone || phone.length < 10 || !/^\d+$/.test(phone)) {
    showFieldError('enrollWhatsapp', 'Please enter a valid 10-digit WhatsApp number.');
    valid = false;
  }

  return valid;
}

function showFieldError(fieldId, message) {
  var input = document.getElementById(fieldId);
  var err   = document.getElementById(fieldId + 'Error');
  if (input) input.classList.add('error-field');
  if (err)   { err.textContent = message; err.classList.add('visible'); }
}

function clearFieldErrors() {
  document.querySelectorAll('.error-field').forEach(function (el) {
    el.classList.remove('error-field');
  });
  document.querySelectorAll('.field-error').forEach(function (el) {
    el.classList.remove('visible');
    el.textContent = '';
  });
}

function setModalStatus(msg, isError) {
  var el = document.getElementById('modalStatus');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'modal-status' + (isError ? ' error' : '');
}

function setModalSubmitLoading(loading) {
  var btn = document.getElementById('enrollSubmitBtn');
  if (!btn) return;
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

/* ── Handle Modal Form Submit (Beginner) ───────────────────── */
function handleEnrollSubmit(e) {
  e.preventDefault();
  if (!validateEnrollForm()) return;

  var name     = document.getElementById('enrollName').value.trim();
  var email    = document.getElementById('enrollEmail').value.trim();
  var whatsapp = document.getElementById('enrollWhatsapp').value.trim();

  _studentData = { name: name, email: email, phone: whatsapp };

  startCheckout('beginner', _studentData, {
    button:   document.getElementById('enrollSubmitBtn'),
    onStatus: setModalStatus,
    onOpened: function () { hideOverlayKeepData_('enrollModal'); }
  });
}

/* Kept for compatibility — re-opens checkout with the last details. */
function initiatePayment() {
  if (!_studentData.name) { openEnrollmentModal(); return; }
  startCheckout('beginner', _studentData, { onOpened: function () { hideOverlayKeepData_('enrollModal'); } });
}

/* ── Hero Autoplay Video — unmute toggle ───────────────────── */
/*
  The hero video autoplays muted (required by browser autoplay
  policies — see note below). This sends a postMessage command to
  the YouTube iframe to unmute/mute on tap, without needing the
  full YT API.
*/
var _heroMuted = true;
function toggleHeroMute() {
  var frame = document.getElementById('heroVideoFrame');
  var btn   = document.getElementById('heroUnmuteBtn');
  if (!frame || !frame.contentWindow) return;
  var cmd = _heroMuted ? 'unMute' : 'mute';
  frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: cmd, args: [] }), '*');
  _heroMuted = !_heroMuted;
  if (btn) {
    btn.textContent = _heroMuted ? '🔇 Tap for sound' : '🔊 Sound on';
    btn.setAttribute('aria-pressed', String(!_heroMuted));
  }
}

/* ── Hero Autoplay Video — auto-unmute on first interaction ──
   Chrome, Safari, Firefox, and every mobile browser block audible
   autoplay until the visitor has interacted with the page — this
   cannot be bypassed. The best compliant workaround: the moment the
   visitor does ANYTHING on the page (scroll, tap, click, or press a
   key), we immediately unmute the hero video for them, so in
   practice most visitors hear sound within a second of landing,
   without ever needing to find the small "Tap for sound" button.
   The button stays on screen as a manual override/mute control. */
function autoUnmuteHeroOnInteraction() {
  if (!_heroMuted) return; // already unmuted (e.g. visitor tapped the button first)
  var frame = document.getElementById('heroVideoFrame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
  }
  _heroMuted = false;
  var btn = document.getElementById('heroUnmuteBtn');
  if (btn) {
    btn.textContent = '🔊 Sound on';
    btn.setAttribute('aria-pressed', 'true');
  }
}
['scroll', 'touchstart', 'click', 'keydown'].forEach(function (evt) {
  window.addEventListener(evt, autoUnmuteHeroOnInteraction, { once: true, passive: true });
});

/* ── UDYAM Registration — view-only modal ──────────────────── */
function openUdyamModal() {
  var overlay = document.getElementById('udyamModal');
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeUdyamModal() {
  var overlay = document.getElementById('udyamModal');
  if (!overlay) return;
  if (!overlay.classList.contains('active')) return;  /* CHECKOUT FIX #5 */
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

/* ── Navigation ────────────────────────────────────────────── */
(function initNav() {
  var nav        = document.getElementById('mainNav');
  var hamburger  = document.getElementById('hamburger');
  var mobileMenu = document.getElementById('mobileMenu');

  if (!nav) return;

  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 60);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      var isOpen = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
    });
    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
      });
    });
  }
})();

/* ── Sticky Buy Bar ─────────────────────────────────────────
   Shows a fixed bottom purchase bar once the visitor has scrolled
   past BOTH the Hero and Bundle sections, and hides it again while
   either of those (or a modal) is in view — so there's never a
   duplicate/competing CTA on screen. The buttons in the bar call
   the SAME openEnrollmentModal()/openProductModal() functions used
   elsewhere on the page; no separate payment logic is created. */
(function initStickyBuyBar() {
  var bar = document.getElementById('stickyBuyBar');
  if (!bar) return;

  var heroEl   = document.getElementById('hero');
  var bundleEl = document.getElementById('bundle');

  var heroVisible   = true;  // assume visible at initial page load
  var bundleVisible = false;

  function update() {
    bar.classList.toggle('visible', !heroVisible && !bundleVisible);
  }

  if ('IntersectionObserver' in window) {
    if (heroEl) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        update();
      }, { threshold: 0 }).observe(heroEl);
    } else {
      heroVisible = false;
    }

    if (bundleEl) {
      new IntersectionObserver(function (entries) {
        bundleVisible = entries[0].isIntersecting;
        update();
      }, { threshold: 0 }).observe(bundleEl);
    }

    update();
  }
  // If IntersectionObserver isn't supported, the bar simply stays
  // hidden (its default state) rather than risk mis-firing.

  // Hide the bar while any purchase modal is open so it never sits
  // on top of a modal/checkout.
  var modalOverlays = document.querySelectorAll('.modal-overlay');
  if (modalOverlays.length && 'MutationObserver' in window) {
    var modalObserver = new MutationObserver(function () {
      var anyOpen = !!document.querySelector('.modal-overlay.active');
      bar.classList.toggle('modal-open', anyOpen);
    });
    modalOverlays.forEach(function (m) {
      modalObserver.observe(m, { attributes: true, attributeFilter: ['class'] });
    });
  }
})();

/* ── FAQ Accordion ─────────────────────────────────────────── */
function toggleFaq(questionEl) {
  var item   = questionEl.closest('.faq-item');
  var isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(function (el) {
    el.classList.remove('open');
    el.querySelector('.faq-question').setAttribute('aria-expanded', false);
  });
  if (!isOpen) {
    item.classList.add('open');
    questionEl.setAttribute('aria-expanded', true);
  }
}

document.querySelectorAll('.faq-question').forEach(function (el) {
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFaq(el);
    }
  });
});

/* ── Scroll Reveal ─────────────────────────────────────────── */
(function initReveal() {
  var els = document.querySelectorAll('[data-reveal]');
  if (!els.length) return;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(function (el) { observer.observe(el); });
})();

/* ── Thank You Pages (Beginner / Advanced / Bundle) ────────────
   SECURITY FIX: the Google Drive links are no longer written into the
   page (anyone could open thankyou.html and take the course free). The
   page asks the Google Script to VERIFY the payment with Razorpay; only
   a verified payment gets the access buttons (the same links are also
   emailed). Meta Purchase fires only after that verification — never
   from the URL alone. Refreshing the page re-verifies (no double count). */
(function initThankYou() {
  var pages = [
    { key: 'beginner', idEl: 'tyPaymentId',         waEl: 'tyWhatsappBtn',         sfx: '' },
    { key: 'advanced', idEl: 'tyPaymentIdAdvanced', waEl: 'tyWhatsappBtnAdvanced', sfx: '_advanced' },
    { key: 'bundle',   idEl: 'tyPaymentIdBundle',   waEl: 'tyWhatsappBtnBundle',   sfx: '_bundle' }
  ];
  var page = null;
  for (var i = 0; i < pages.length; i++) if (document.getElementById(pages[i].idEl)) { page = pages[i]; break; }
  if (!page) return;
  var product = PRODUCTS[page.key];

  var params    = new URLSearchParams(window.location.search);
  var paymentId = params.get('payment_id') || safeGet_('sessionStorage', 'rzp_payment_id' + page.sfx) || '';
  var name  = safeGet_('sessionStorage', 'rzp_student_name' + page.sfx)  || '';
  var email = safeGet_('sessionStorage', 'rzp_student_email' + page.sfx) || '';
  var phone = safeGet_('sessionStorage', 'rzp_student_phone' + page.sfx) || '';
  var validId = /^pay_[A-Za-z0-9]{6,40}$/.test(paymentId);

  var idEl = document.getElementById(page.idEl);
  if (idEl) idEl.textContent = validId ? paymentId : 'N/A';
  var nameEl = document.getElementById('tyStudentName');
  if (nameEl && name) nameEl.textContent = name;

  var waBtn = document.getElementById(page.waEl);
  if (waBtn && validId) {
    var waText = 'Hi! I purchased ' + product.name + (name ? ' (Name: ' + name + ')' : '') +
      '. My Payment ID is ' + paymentId + '. I need help accessing my course.';
    waBtn.href = 'https://wa.me/' + PAYMENT_RECOVERY.WHATSAPP_NUMBER + '?text=' + encodeURIComponent(waText);
  }

  var box = document.getElementById('tyAccess');
  var statusEl = document.getElementById('tyAccessStatus');
  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  if (!validId) {
    setStatus('We could not find a payment reference. If you have paid, your access link has been emailed to you — or contact us on WhatsApp.');
    return;
  }

  function showAccess(links) {
    if (!box) return;
    box.textContent = '';
    links.forEach(function (l, idx) {
      if (!/^https:\/\//.test(l.url)) return;
      var a = document.createElement('a');
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = l.label;
      if (idx === 0 || /^🎵/.test(l.label)) {
        a.className = 'btn btn-primary btn-lg btn-full';
      } else {
        a.className = 'btn btn-outline-dark btn-lg btn-full';
        a.style.cssText = 'border-color:rgba(255,255,255,0.2);color:rgba(255,255,255,0.75)';
      }
      box.appendChild(a);
    });
  }

  function firePurchase(amount) {
    var key = 'px_purchase_fired_' + paymentId;
    if (safeGet_('localStorage', key) || safeGet_('sessionStorage', key)) return;
    safeSet_('localStorage', key, '1');
    safeSet_('sessionStorage', key, '1');
    setPixelAdvancedMatching({ name: name, email: email, phone: phone });
    fbqTrack('Purchase', {
      value: amount || product.price, currency: 'INR', content_name: product.name,
      content_type: 'product', transaction_id: paymentId
    }, { eventID: paymentId });   // same event_id as the server CAPI Purchase → Meta de-duplicates
  }

  var delays = [0, 2000, 3000, 5000, 8000, 12000, 15000, 20000, 30000];
  var i = 0;
  (function attempt() {
    scriptGet_({ action: 'verify', paymentId: paymentId }, 20000)
      .then(function (res) {
        var s = res && res.status;
        if (s === 'paid' && res.product === page.key) {
          if (res.name && !name) name = res.name;
          if (res.email && !email) email = res.email;
          if (nameEl && name) nameEl.textContent = name;
          showAccess(res.access || []);
          setStatus('✅ Payment verified. The same access links have also been emailed to you' + (email ? ' at ' + email : '') + '.');
          firePurchase(res.amount);
          return true;
        }
        if (s === 'paid' && res.product !== page.key) {
          var right = PRODUCTS[res.product];
          if (right) { window.location.replace(right.thankyouUrl + '?payment_id=' + encodeURIComponent(paymentId)); return true; }
        }
        if (['failed', 'refunded', 'amount_mismatch', 'not_course_payment', 'not_found'].indexOf(s) !== -1) {
          if (box) box.textContent = '';
          setStatus('This payment could not be confirmed by Razorpay (' + s + '). If money was deducted, please contact us on WhatsApp with your Payment ID.');
          return true;
        }
        if (s === 'pending') setStatus('Your bank is still confirming the payment — this can take a minute…');
        return false;
      })
      .catch(function () { return false; })
      .then(function (done) {
        if (done) return;
        i++;
        if (i < delays.length) { setTimeout(attempt, delays[i]); return; }
        setStatus('Your payment is being confirmed. Your course access will be emailed to you as soon as it is confirmed. Didn\'t get it? Contact us on WhatsApp with your Payment ID.');
      });
  })();
})();

/* ── Smooth Scroll ─────────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
  anchor.addEventListener('click', function (e) {
    var target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ── ViewContent on video section visible ──────────────────── */
(function trackVideoView() {
  var section = document.getElementById('free-lesson');
  if (!section) return;
  var tracked = false;
  var obs = new IntersectionObserver(function (entries) {
    if (!tracked && entries[0].isIntersecting) {
      fbqTrack('ViewContent', { content_name: 'Free First Lesson Video', content_type: 'video' });
      tracked = true;
      obs.disconnect();
    }
  }, { threshold: 0.5 });
  obs.observe(section);
})();

/* ── Contact Form ──────────────────────────────────────────── */
function submitContact(e) {
  e.preventDefault();
  var btn    = document.getElementById('submitBtn');
  var status = document.getElementById('formStatus');
  btn.textContent = 'Sending…';
  btn.disabled    = true;

  var data = {
    name:    document.getElementById('name').value,
    email:   document.getElementById('email').value,
    phone:   document.getElementById('phone').value,
    message: document.getElementById('message').value,
    type:    'contact_form',
  };

  /* Uses GOOGLE_SCRIPT_URL if configured, else falls back gracefully */
  var url = isScriptConfigured() ? GOOGLE_SCRIPT_URL : null;

  if (!url) {
    /* No backend configured — open WhatsApp as fallback */
    var wa = 'https://wa.me/' + WHATSAPP_NUM + '?text=' +
      encodeURIComponent('Name: ' + data.name + '\nEmail: ' + data.email + '\nMessage: ' + data.message);
    window.open(wa, '_blank');
    status.textContent = '✅ Opening WhatsApp for you…';
    btn.textContent    = 'Send Message';
    btn.disabled       = false;
    return;
  }

  fetch(url, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(data),
  })
  .then(function () {
    /* no-cors = opaque response; treat as success */
    status.textContent = '✅ Message sent! We\'ll reply within a few hours.';
    document.getElementById('contactForm').reset();
  })
  .catch(function () {
    status.textContent = 'Could not send. Please WhatsApp us directly.';
    status.style.color = '#EF4444';
  })
  .finally(function () {
    btn.textContent = 'Send Message';
    btn.disabled    = false;
  });
}

/* ============================================================
   ADDED — Advanced Course + Bundle Offer + Rotating Timers
   Everything below is NEW and additive. Nothing above this
   line was modified — the existing Beginner Course purchase
   flow, Meta Pixel, and Apps Script integration are untouched.
   ============================================================ */
/* Product config (Advanced + Bundle) now lives in PRODUCTS at the top of this file. */

/* Per-product transient state (mirrors the _studentData pattern
   used by the Beginner flow, kept separate so nothing collides). */
var _productState = {
  advanced: { data: {}, rowToken: '' },
  bundle:   { data: {}, rowToken: '' },
};

/* ── Generic Modal Open/Close ──────────────────────────────── */
function openProductModal(productKey) {
  var product = PRODUCTS[productKey];
  if (!product) return;
  prefetchOrder_(productKey);   // v4: Razorpay order is ready before Submit
  fbqTrack('InitiateCheckout', {
    value: product.price,
    currency: 'INR',
    content_name: product.name,
    content_type: 'product',
  });
  var overlay = document.getElementById('enrollModal' + capitalize_(productKey));
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(function () {
    var first = overlay.querySelector('input');
    if (first) first.focus();
  }, 300);
}

function closeProductModal(productKey) {
  var overlay = document.getElementById('enrollModal' + capitalize_(productKey));
  if (!overlay) return;
  if (!overlay.classList.contains('active')) return;  /* CHECKOUT FIX #5 */
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  var form = document.getElementById('enrollForm' + capitalize_(productKey));
  if (form) form.reset();
  document.querySelectorAll('#enrollModal' + capitalize_(productKey) + ' .error-field').forEach(function (el) {
    el.classList.remove('error-field');
  });
  document.querySelectorAll('#enrollModal' + capitalize_(productKey) + ' .field-error').forEach(function (el) {
    el.classList.remove('visible'); el.textContent = '';
  });
  setProductModalStatus(productKey, '', false);
  setProductModalSubmitLoading(productKey, false);
}

function capitalize_(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* Escape / click-outside handling for the new modals (additive —
   does not touch the existing Beginner/Udyam listeners above). */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  closeProductModal('advanced');
  closeProductModal('bundle');
});
document.addEventListener('click', function (e) {
  if (!e.target.classList || !e.target.classList.contains('modal-overlay')) return;
  if (e.target.id === 'enrollModalAdvanced') closeProductModal('advanced');
  if (e.target.id === 'enrollModalBundle')   closeProductModal('bundle');
});

function setProductModalStatus(productKey, msg, isError) {
  var el = document.getElementById('modalStatus' + capitalize_(productKey));
  if (!el) return;
  el.textContent = msg;
  el.className = 'modal-status' + (isError ? ' error' : '');
}

function setProductModalSubmitLoading(productKey, loading) {
  var btn = document.getElementById('enrollSubmitBtn' + capitalize_(productKey));
  if (!btn) return;
  if (loading) { btn.classList.add('loading'); btn.disabled = true; }
  else         { btn.classList.remove('loading'); btn.disabled = false; }
}

function validateProductForm(productKey) {
  var suffix = capitalize_(productKey);
  var name     = (document.getElementById('enrollName' + suffix)     || {}).value || '';
  var email    = (document.getElementById('enrollEmail' + suffix)    || {}).value || '';
  var whatsapp = (document.getElementById('enrollWhatsapp' + suffix) || {}).value || '';
  var valid = true;

  function showErr(fieldId, message) {
    var input = document.getElementById(fieldId);
    var err   = document.getElementById(fieldId + 'Error');
    if (input) input.classList.add('error-field');
    if (err)   { err.textContent = message; err.classList.add('visible'); }
  }

  if (!name.trim() || name.trim().length < 2) {
    showErr('enrollName' + suffix, 'Please enter your full name (at least 2 characters).'); valid = false;
  }
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.trim() || !emailRegex.test(email.trim())) {
    showErr('enrollEmail' + suffix, 'Please enter a valid email address.'); valid = false;
  }
  var phone = whatsapp.replace(/[\s\-\+\(\)]/g, '');
  if (!phone || phone.length < 10 || !/^\d+$/.test(phone)) {
    showErr('enrollWhatsapp' + suffix, 'Please enter a valid 10-digit WhatsApp number.'); valid = false;
  }
  return valid;
}

function handleProductSubmit(e, productKey) {
  e.preventDefault();
  if (!validateProductForm(productKey)) return;
  var suffix = capitalize_(productKey);

  var name     = document.getElementById('enrollName' + suffix).value.trim();
  var email    = document.getElementById('enrollEmail' + suffix).value.trim();
  var whatsapp = document.getElementById('enrollWhatsapp' + suffix).value.trim();

  _productState[productKey].data = { name: name, email: email, phone: whatsapp };

  startCheckout(productKey, _productState[productKey].data, {
    button:   document.getElementById('enrollSubmitBtn' + suffix),
    onStatus: function (msg, isError) { setProductModalStatus(productKey, msg, isError); },
    onOpened: function () { hideOverlayKeepData_('enrollModal' + suffix); }
  });
}

/* Kept for compatibility — re-opens checkout with the last details. */
function initiateProductPayment(productKey) {
  var state = _productState[productKey];
  if (!state || !state.data.name) { openProductModal(productKey); return; }
  startCheckout(productKey, state.data, { onOpened: function () { hideOverlayKeepData_('enrollModal' + capitalize_(productKey)); } });
}

/* ── Rotating 3-Hour Countdown Timer ────────────────────────────
   Persistent via localStorage: each timer's end-time is stored
   under its own key, so a page refresh does NOT restart the
   countdown from 3 hours — it keeps counting down from wherever
   it actually was. When it reaches zero (whether the tab is open
   or the visitor returns later), it automatically rolls forward
   to a fresh 3-hour window, forever. Every element with
   class="offer-timer" and a unique id is driven independently. */
function initRotatingTimer(elementId, storageKey, durationMs) {
  var el = document.getElementById(elementId);
  if (!el) return;
  var hEl = el.querySelector('[data-unit="h"]');
  var mEl = el.querySelector('[data-unit="m"]');
  var sEl = el.querySelector('[data-unit="s"]');

  function getEndTime() {
    var stored = null;
    try { stored = parseInt(localStorage.getItem(storageKey), 10); } catch (e) { /* ignore */ }
    var now = Date.now();
    if (!stored || isNaN(stored) || stored <= now) {
      var next = now + durationMs;
      try { localStorage.setItem(storageKey, String(next)); } catch (e) { /* ignore */ }
      return next;
    }
    return stored;
  }

  var endTime = getEndTime();

  function pad_(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var remaining = endTime - Date.now();
    if (remaining <= 0) {
      endTime = getEndTime(); // auto-rotate to a fresh 3-hour window
      remaining = endTime - Date.now();
    }
    var totalSeconds = Math.max(0, Math.floor(remaining / 1000));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    if (hEl) hEl.textContent = pad_(h);
    if (mEl) mEl.textContent = pad_(m);
    if (sEl) sEl.textContent = pad_(s);
  }

  tick();
  setInterval(tick, 1000);
}

(function initAllTimers() {
  var THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  initRotatingTimer('beginnerOfferTimer',        'fm_timer_beginner_end',  THREE_HOURS_MS);
  initRotatingTimer('beginnerOfferTimerPricing', 'fm_timer_beginner_end',  THREE_HOURS_MS); // same offer/key as hero timer, just displayed twice
  initRotatingTimer('advancedOfferTimer',        'fm_timer_advanced_end', THREE_HOURS_MS);
  initRotatingTimer('advancedOfferTimerPricing', 'fm_timer_advanced_end', THREE_HOURS_MS);
  initRotatingTimer('bundleOfferTimer',          'fm_timer_bundle_end',   THREE_HOURS_MS);
  initRotatingTimer('bundleOfferTimerAdv',       'fm_timer_bundle_end',   THREE_HOURS_MS);
})();

/* ============================================================
   PAYMENT RECOVERY — floating "Payment failed? — Pay here" button
   (above a WhatsApp button) + recovery popup. Sales pages only.
   - NEVER opens automatically. Only when the customer taps it.
   - Retry Payment reuses the same order and the details already typed.
   - Manual UPI: QR + UPI ID + Copy, then WhatsApp the screenshot.
     Manual payments are verified by you (Manual Payments tab) — nothing
     here marks anything paid or fires the Meta Purchase event.
   All details come from PAYMENT_RECOVERY at the top of this file.
   ============================================================ */
(function initPaymentRecovery() {
  if (!document.querySelector('.modal-overlay[id^="enrollModal"]')) return; // sales pages only

  var PR = PAYMENT_RECOVERY;
  var WA = String(PR.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  var WA_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.480-8.413Z"/></svg>';

  function fmt(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function waLink(text) { return 'https://wa.me/' + WA + '?text=' + encodeURIComponent(text); }

  // Default product: the last one the customer tried, else this page's main product.
  var defaultKey = document.getElementById('enrollModal') ? 'beginner' : 'advanced';
  function lastCheckout() {
    if (_lastCheckout) return _lastCheckout;
    try {
      var s = JSON.parse(safeGet_('localStorage', 'fm_last_checkout') || 'null');
      if (s && PRODUCTS[s.productKey] && Date.now() - (s.at || 0) < ATTEMPT_MAX_AGE_MS) return s;
    } catch (e) { /* ignore */ }
    return null;
  }
  var selectedKey = (lastCheckout() && lastCheckout().productKey) || defaultKey;

  /* ── Markup ─────────────────────────────────────────────── */
  var root = document.createElement('div');
  root.innerHTML =
    '<a class="fm-wa-float" id="fmWaFloat" target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp">' + WA_ICON + '</a>' +
    '<button type="button" class="fm-pay-float" id="fmPayFloat" aria-haspopup="dialog" aria-controls="fmRecoveryModal">' +
      '<span class="fm-pay-float-inner">Payment failed? — <span class="fm-pay-here">Pay here</span></span>' +
    '</button>' +
    '<div class="modal-overlay fm-pr-overlay" id="fmRecoveryModal" role="dialog" aria-modal="true" aria-labelledby="fmPrTitle" aria-hidden="true">' +
      '<div class="modal-box fm-pr-box">' +
        '<button type="button" class="modal-close" id="fmPrClose" aria-label="Close">✕</button>' +
        '<h2 class="modal-title" id="fmPrTitle">Payment failed?</h2>' +
        '<p class="modal-subtitle fm-pr-lede">Don\'t worry — complete your payment manually using UPI below, or retry the payment.</p>' +

        '<div class="fm-pr-products" role="radiogroup" aria-label="Which course?" id="fmPrProducts"></div>' +
        '<div class="modal-price-row fm-pr-amount"><span class="modal-price-label">Amount to pay</span>' +
          '<span><span class="modal-price-amount" id="fmPrPrice"></span><span class="modal-price-orig" id="fmPrOrig"></span></span></div>' +

        '<div class="fm-pr-block">' +
          '<div class="fm-pr-label">Option 1 · Scan &amp; Pay</div>' +
          '<img class="fm-pr-qr" id="fmPrQr" width="400" height="477" loading="lazy" decoding="async" alt="UPI QR code to pay Flute Mastery">' +
          '<p class="fm-pr-note">Scan the QR code using any UPI app and pay <strong id="fmPrPrice2"></strong>.</p>' +
        '</div>' +

        '<div class="fm-pr-block">' +
          '<div class="fm-pr-label">Option 2 · Pay using UPI ID</div>' +
          '<div class="fm-pr-upi-row"><span class="fm-pr-upi-id" id="fmPrUpi"></span>' +
          '<button type="button" class="fm-pr-copy" id="fmPrCopy">Copy UPI ID</button></div>' +
          '<div class="fm-pr-copied" id="fmPrCopied" role="status" aria-live="polite"></div>' +
        '</div>' +

        '<div class="fm-pr-block" id="fmPrPhoneBlock">' +
          '<div class="fm-pr-label">Option 3 · Pay to Phone Number</div>' +
          '<div class="fm-pr-upi-row"><span class="fm-pr-upi-id" id="fmPrPayPhone"></span>' +
          '<button type="button" class="fm-pr-copy" id="fmPrCopyPhone">Copy Number</button></div>' +
          '<div class="fm-pr-copied" id="fmPrCopiedPhone" role="status" aria-live="polite"></div>' +
          '<p class="fm-pr-payee">Name shown in your payment app: <strong id="fmPrPayName"></strong>' +
          '<span>This is our official payment account — you can pay safely.</span></p>' +
          '<p class="fm-pr-note">Open any UPI app → <strong>Pay to phone number</strong> → paste the number → pay <strong class="fm-pr-price3"></strong>.</p>' +
        '</div>' +

        '<div class="fm-pr-after"><strong>After completing the payment,</strong> send the payment screenshot on WhatsApp.' +
          '<a class="fm-pr-wa-btn" id="fmPrWa" target="_blank" rel="noopener">' + WA_ICON + ' Send Payment Screenshot on WhatsApp</a>' +
          '<ul class="fm-pr-steps"><li>We verify your payment from the screenshot</li>' +
          '<li>Your course access is then sent to you on WhatsApp and email</li></ul>' +
        '</div>' +

        '<div class="fm-pr-support">Having trouble with payment?<br>Call / WhatsApp: <strong id="fmPrPhone"></strong>' +
          '<div class="fm-pr-support-actions"><a id="fmPrCall">📞 Call</a><a id="fmPrSupportWa" target="_blank" rel="noopener">💬 WhatsApp</a></div>' +
        '</div>' +

        '<div class="fm-pr-or">or</div>' +
        '<button type="button" class="btn btn-primary btn-full btn-lg modal-submit" id="fmPrRetry"><span class="btn-text">🔁 Retry Payment</span></button>' +
        '<p class="modal-status" id="fmPrStatus"></p>' +

        '<div class="fm-pr-already"><strong>Already paid?</strong>' +
          'Send your payment screenshot on WhatsApp and we\'ll verify it and provide your access.' +
          '<a id="fmPrAlreadyWa" target="_blank" rel="noopener">' + WA_ICON + ' Send Screenshot on WhatsApp</a>' +
        '</div>' +
      '</div>' +
    '</div>';
  while (root.firstChild) document.body.appendChild(root.firstChild);

  var $ = function (id) { return document.getElementById(id); };
  var modal = $('fmRecoveryModal'), payFloat = $('fmPayFloat'), waFloat = $('fmWaFloat');

  /* ── Static details from config ─────────────────────────── */
  waFloat.href = waLink('Hi! I have a question about the Flute Mastery courses.');
  $('fmPrUpi').textContent = PR.UPI_ID || '';
  var payDigits = String(PR.PAY_PHONE_NUMBER || '').replace(/\D/g, '').slice(-10);
  if (payDigits.length === 10) {
    $('fmPrPayPhone').textContent = '+91 ' + payDigits.slice(0, 5) + ' ' + payDigits.slice(5);
    $('fmPrPayName').textContent = PR.PAY_PHONE_NAME || '';
    if (!PR.PAY_PHONE_NAME) $('fmPrPhoneBlock').querySelector('.fm-pr-payee').style.display = 'none';
  } else {
    $('fmPrPhoneBlock').style.display = 'none';   // not configured yet → hidden
  }
  var qr = $('fmPrQr');
  qr.addEventListener('error', function () { qr.style.display = 'none'; });   // missing file → hide, no broken icon
  if (PR.QR_IMAGE) { qr.src = PR.QR_IMAGE; qr.alt = 'UPI QR code to pay Flute Mastery (' + (PR.UPI_ID || '') + ')'; } else { qr.style.display = 'none'; }
  $('fmPrPhone').textContent = PR.SUPPORT_PHONE_DISPLAY || ('+' + WA);
  $('fmPrCall').href = 'tel:' + String(PR.SUPPORT_PHONE_TEL || ('+' + WA)).replace(/[^\d+]/g, '');
  $('fmPrSupportWa').href = waLink('Hi! I\'m having trouble paying for a Flute Mastery course. Can you help?');

  /* ── Product selector ───────────────────────────────────── */
  var pWrap = $('fmPrProducts');
  ['beginner', 'advanced', 'bundle'].forEach(function (k) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'fm-pr-product'; b.setAttribute('role', 'radio'); b.dataset.key = k;
    b.innerHTML = '<span>' + PRODUCTS[k].shortName + '</span><strong>' + fmt(PRODUCTS[k].price) + '</strong>';
    b.addEventListener('click', function () { selectedKey = k; refresh(); });
    pWrap.appendChild(b);
  });

  function customer() {
    var lc = lastCheckout();
    return (lc && lc.productKey === selectedKey && lc.data) || (lc && lc.data) || {};
  }
  function screenshotMessage() {
    var p = PRODUCTS[selectedKey], c = customer(), a = loadAttempt_(selectedKey);
    var lines = ['Hi, I have completed the payment for "' + p.name + '" (' + fmt(p.price) + '). I am sending my payment screenshot. Please verify my payment and provide my course access.'];
    var extra = [];
    if (c.name) extra.push('Name: ' + c.name);
    if (c.email) extra.push('Email: ' + c.email);
    if (c.phone) extra.push('WhatsApp: ' + c.phone);
    if (a && a.ref) extra.push('Order ref: ' + a.ref);
    if (extra.length) lines.push('', extra.join('\n'));
    return lines.join('\n');
  }
  function refresh() {
    var p = PRODUCTS[selectedKey];
    Array.prototype.forEach.call(pWrap.children, function (b) {
      var on = b.dataset.key === selectedKey;
      b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('fmPrPrice').textContent = fmt(p.price);
    $('fmPrPrice2').textContent = fmt(p.price);
    Array.prototype.forEach.call(modal.querySelectorAll('.fm-pr-price3'), function (el) { el.textContent = fmt(p.price); });
    $('fmPrOrig').textContent = p.originalPrice ? fmt(p.originalPrice) : '';
    var msg = waLink(screenshotMessage());
    $('fmPrWa').href = msg; $('fmPrAlreadyWa').href = msg;
  }

  /* ── Open / close ───────────────────────────────────────── */
  var lastFocus = null;
  function openRecovery() {
    var lc = lastCheckout();
    if (lc) selectedKey = lc.productKey;
    refresh();
    $('fmPrCopied').textContent = ''; $('fmPrCopiedPhone').textContent = ''; $('fmPrStatus').textContent = '';
    lastFocus = document.activeElement;
    modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.fm-pr-box').scrollTop = 0;
    setTimeout(function () { try { $('fmPrClose').focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }
  function closeRecovery() {
    if (!modal.classList.contains('active')) return;
    modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  payFloat.addEventListener('click', openRecovery);
  $('fmPrClose').addEventListener('click', closeRecovery);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeRecovery(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeRecovery(); });

  /* ── Retry: same order + same details, no page reload ───── */
  $('fmPrRetry').addEventListener('click', function () {
    var lc = lastCheckout();
    if (lc && lc.productKey === selectedKey && lc.data && lc.data.name) {
      startCheckout(selectedKey, lc.data, {
        button:   $('fmPrRetry'),
        onStatus: function (m, err) { var s = $('fmPrStatus'); s.textContent = m; s.className = 'modal-status' + (err ? ' error' : ''); },
        onOpened: closeRecovery
      });
      return;
    }
    // No saved details (fresh visit) → open that course's details popup.
    closeRecovery();
    if (selectedKey === 'beginner' && document.getElementById('enrollModal')) openEnrollmentModal();
    else if (document.getElementById('enrollModal' + capitalize_(selectedKey))) openProductModal(selectedKey);
    else window.location.href = selectedKey === 'advanced' ? 'advanced.html' : 'index.html';
  });

  /* ── Copy UPI ID (Clipboard API → legacy fallback → select text) ── */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  var copyTimers = {};
  function copyText(text, outId, textElId, okMsg) {
    var out = $(outId);
    function done(ok) {
      if (ok) { out.style.color = '#6FE3A3'; out.textContent = okMsg; }
      else {
        out.style.color = 'rgba(255,255,255,0.6)';
        out.textContent = 'Couldn\'t copy automatically — press and hold the text above to copy it.';
        try { var r = document.createRange(); r.selectNodeContents($(textElId)); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* ignore */ }
      }
      clearTimeout(copyTimers[outId]); copyTimers[outId] = setTimeout(function () { out.textContent = ''; }, 3500);
    }
    if (!text) { done(false); return; }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    else done(legacyCopy(text));
  }
  $('fmPrCopy').addEventListener('click', function () {
    copyText(String(PR.UPI_ID || '').trim(), 'fmPrCopied', 'fmPrUpi', '✓ UPI ID copied!');
  });
  $('fmPrCopyPhone').addEventListener('click', function () {
    copyText(payDigits, 'fmPrCopiedPhone', 'fmPrPayPhone', '✓ Phone number copied!');
  });

  /* ── Floating buttons: WhatsApp at the bottom, "Pay here" 12 px above it;
     both lift above the sticky buy bar when it is showing, and hide while a
     popup is open. ── */
  var bar = document.getElementById('stickyBuyBar');
  function place() {
    try {
      var base = 20;
      if (bar && bar.classList.contains('visible') && !bar.classList.contains('modal-open')) {
        var br = bar.getBoundingClientRect();
        if (br.height > 0 && br.top < window.innerHeight) base = Math.max(base, window.innerHeight - br.top + 12);
      }
      waFloat.style.bottom = 'calc(' + base + 'px + env(safe-area-inset-bottom, 0px))';
      var wr = waFloat.getBoundingClientRect();
      payFloat.style.bottom = 'calc(' + (base + (wr.height || 52) + 12) + 'px + env(safe-area-inset-bottom, 0px))';
      var anyModal = !!document.querySelector('.modal-overlay.active');
      waFloat.classList.toggle('fm-hidden', anyModal);
      payFloat.classList.toggle('fm-hidden', anyModal);
    } catch (e) { /* visual only */ }
  }
  var queued = false;
  function queue() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; place(); }); }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(queue);
    document.querySelectorAll('.modal-overlay').forEach(function (m) { mo.observe(m, { attributes: true, attributeFilter: ['class'] }); });
    if (bar) mo.observe(bar, { attributes: true, attributeFilter: ['class'] });
  }
  if (bar) bar.addEventListener('transitionend', queue);
  place();
  setTimeout(place, 400);
})();
