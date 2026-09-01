/* ============================================================
   FLUTE MASTERY — script.js  (v3 — duplicate fix)
   Handles: Enrollment Modal, Nav, FAQ, Razorpay, Meta Pixel,
            Google Apps Script, Scroll Animations
   ============================================================ */

'use strict';

/* ── CONFIGURATION ─────────────────────────────────────────── */
var RAZORPAY_KEY_ID   = 'rzp_live_Sczvk68iCuryMo'; // ← REPLACE with your Razorpay Key ID
var COURSE_AMOUNT     = 79900;                         // paise (₹799)
var COURSE_NAME       = 'Flute Mastery — Complete Course';
var BUSINESS_NAME     = 'Flute Mastery';
var LOGO_URL          = '';
var WHATSAPP_NUM      = '918709268496';
var THANKYOU_URL      = 'thankyou.html';
var PIXEL_ID          = '1001951225815875';

/*
  Google Apps Script Web App URL.
  After deploying your Apps Script (see google-apps-script.gs),
  paste the generated URL here.
*/
var GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwOmE8vIS60dX-IJd1o4YuyL_WAREizex7pWmpn0qNoz8RR-Mw-CRRYGB9QtCQF7Jdh/exec'; // ← REPLACE

/* ── Meta Pixel Helper ─────────────────────────────────────── */
/* CAPI FIX: added optional 3rd "options" param so callers can pass
   { eventID: '...' }. The eventID (NOT part of custom data) is what
   Meta uses to de-duplicate a Browser event against the matching
   Server (CAPI) event that shares the same event_id. */
function fbqTrack(event, data, options) {
  if (typeof fbq === 'function') {
    fbq('track', event, data || {}, options || {});
  }
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

/* ── Enrollment Modal ──────────────────────────────────────── */
/*
  The modal collects Name, Email, and WhatsApp before opening
  Razorpay.  Student data is first saved to Google Sheets
  (status = "pending"), then Razorpay opens.  On success the
  row is updated with the Payment ID and status = "paid".
*/

var _studentData = {}; // holds form data between modal → Razorpay

// FIX: A unique token generated at form-submit time, reused on the
// paid update. This lets Apps Script reliably match the two calls
// to the same row without relying on email alone.
var _rowToken = '';

function openEnrollmentModal() {
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

/* ── Handle Modal Form Submit ──────────────────────────────── */
function handleEnrollSubmit(e) {
  e.preventDefault();
  if (!validateEnrollForm()) return;

  var name     = document.getElementById('enrollName').value.trim();
  var email    = document.getElementById('enrollEmail').value.trim();
  var whatsapp = document.getElementById('enrollWhatsapp').value.trim();

  _studentData = { name: name, email: email, phone: whatsapp };

  // FIX: Generate a unique token for this enrollment session.
  // The same token is sent with both the pending and paid requests,
  // so Apps Script can always find and update the correct row.
  _rowToken = 'row_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  setModalSubmitLoading(true);
  setModalStatus('Saving your details…', false);

  /* Step 1 — Save lead to Google Sheets (status: pending) */
  saveLeadToSheet({
    name:      name,
    email:     email,
    phone:     whatsapp,
    paymentId: '',
    status:    'pending',
    amount:    '799',
    course:    COURSE_NAME,
    rowToken:  _rowToken,
  })
  .then(function () {
    setModalStatus('Opening secure payment…', false);
    /* Step 2 — Open Razorpay */
    setTimeout(function () {
      setModalSubmitLoading(false);
      closeEnrollmentModal();
      initiatePayment();
    }, 400);
  })
  .catch(function (err) {
    /* If sheet save fails, still open Razorpay — don't block payment */
    console.warn('[Sheet] Lead save failed, continuing to payment:', err);
    setModalStatus('', false);
    setModalSubmitLoading(false);
    closeEnrollmentModal();
    initiatePayment();
  });
}

/* ── Save Lead / Update Row in Google Sheets ───────────────── */
/*
  FIX: previously this used a plain (non-awaited) fetch() immediately
  followed by window.location.href to the thank-you page. The browser
  can cancel an in-flight fetch the instant navigation starts, so the
  "paid" write (and therefore the confirmation email it triggers on
  the Apps Script side) could silently never reach Google — this is
  the most likely cause of "payment made but sheet/email didn't fire".

  Fix: use navigator.sendBeacon() first — it's specifically designed
  to guarantee delivery of a small POST even across a page unload/
  redirect. Falls back to fetch(..., { keepalive: true }) for the
  rare browser without sendBeacon support, which gives the same
  survive-navigation guarantee.
*/
function saveLeadToSheet(data) {
  return new Promise(function (resolve) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) {
      console.warn('[Sheet] GOOGLE_SCRIPT_URL not configured — skipping sheet write.');
      resolve();
      return;
    }
    var payload = JSON.stringify(data);

    if (navigator.sendBeacon) {
      try {
        var blob = new Blob([payload], { type: 'text/plain' });
        var queued = navigator.sendBeacon(GOOGLE_SCRIPT_URL, blob);
        if (queued) { resolve(); return; }
      } catch (e) { /* fall through to fetch */ }
    }

    fetch(GOOGLE_SCRIPT_URL, {
      method:    'POST',
      mode:      'no-cors',   /* GAS requires no-cors */
      keepalive: true,        /* survives navigation, same guarantee as sendBeacon */
      headers:   { 'Content-Type': 'text/plain' },
      body:      payload,
    })
    .then(function () { resolve(); })   /* no-cors response is opaque — always resolve */
    .catch(function (err) { console.error('[Sheet] Write failed:', err); resolve(); });
  });
}

/* ── Razorpay Payment ──────────────────────────────────────── */
function initiatePayment() {
  if (!_studentData.name) {
    /* Fallback: open modal instead of going straight to Razorpay */
    openEnrollmentModal();
    return;
  }

  var options = {
    key:         RAZORPAY_KEY_ID,
    amount:      COURSE_AMOUNT,
    currency:    'INR',
    name:        BUSINESS_NAME,
    description: COURSE_NAME,
    image:       LOGO_URL,

    prefill: {
      name:    _studentData.name  || '',
      email:   _studentData.email || '',
      contact: _studentData.phone || '',
    },

    notes: {
      product:       COURSE_NAME,
      student_name:  _studentData.name  || '',
      student_email: _studentData.email || '',
    },

    theme: { color: '#C9922A' },

    modal: {
      ondismiss: function () {
        console.log('[Razorpay] Checkout dismissed');
        _studentData = {};
        _rowToken    = '';
      },
    },

    handler: function (response) {
      var paymentId = response.razorpay_payment_id;
      var orderId   = response.razorpay_order_id   || '';
      var signature = response.razorpay_signature   || '';

      /* Persist for thank-you page */
      try {
        sessionStorage.setItem('rzp_payment_id',    paymentId);
        sessionStorage.setItem('rzp_student_name',  _studentData.name  || '');
        sessionStorage.setItem('rzp_student_email', _studentData.email || '');
        /* CAPI FIX: phone wasn't persisted before — needed on thankyou.html
           to set manual Advanced Matching before the Purchase event fires. */
        sessionStorage.setItem('rzp_student_phone', _studentData.phone || '');
      } catch (e) { /* ignore */ }

      /* Step 3 — Update sheet row with payment confirmation + trigger email.
         Pass the same rowToken so Apps Script matches the correct row.
         saveLeadToSheet() now uses sendBeacon (guaranteed delivery across
         navigation), so it's safe to redirect immediately after calling it.

         CAPI FIX: also forward everything Apps Script needs to send a
         high-quality server-side Purchase event to Meta — the normalized
         phone (for hashing), the _fbp/_fbc browser cookies (Meta's own
         browser-to-server matching keys), the event source URL, and the
         user agent. paymentId doubles as the CAPI event_id for dedup. */
      saveLeadToSheet({
        name:            _studentData.name  || '',
        email:           _studentData.email || '',
        phone:           _studentData.phone || '',
        phoneNormalized: normalizePhoneForMatching(_studentData.phone),
        paymentId:       paymentId,
        orderId:         orderId,
        status:          'paid',
        amount:          '799',
        course:          COURSE_NAME,
        rowToken:        _rowToken,
        fbp:             getCookie('_fbp'),
        fbc:             getCookie('_fbc'),
        eventSourceUrl:  window.location.origin + '/' + THANKYOU_URL,
        clientUserAgent: navigator.userAgent || '',
      }).catch(function (err) {
        console.error('[Sheet] Payment update failed:', err);
      });

      /* Redirect */
      window.location.href = THANKYOU_URL + '?payment_id=' + encodeURIComponent(paymentId);
    },
  };

  var rzp = new Razorpay(options);

  rzp.on('payment.failed', function (response) {
    console.error('[Razorpay] Payment failed:', response.error);
    alert('Payment failed: ' + (response.error.description || 'Unknown error') + '. Please try again or WhatsApp us at +91 87092 68496.');
  });

  rzp.open();
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

/* ── Thank You Page ────────────────────────────────────────── */
(function initThankYou() {
  if (!document.getElementById('tyPaymentId')) return;

  var params    = new URLSearchParams(window.location.search);
  var paymentId = params.get('payment_id') ||
    (function () { try { return sessionStorage.getItem('rzp_payment_id'); } catch (e) { return ''; } })() || 'N/A';
  var name  = (function () { try { return sessionStorage.getItem('rzp_student_name');  } catch (e) { return ''; } })() || '';
  var email = (function () { try { return sessionStorage.getItem('rzp_student_email'); } catch (e) { return ''; } })() || '';
  var phone = (function () { try { return sessionStorage.getItem('rzp_student_phone'); } catch (e) { return ''; } })() || '';

  var idEl   = document.getElementById('tyPaymentId');
  var nameEl = document.getElementById('tyStudentName');
  if (idEl)   idEl.textContent   = paymentId;
  if (nameEl && name) nameEl.textContent = name;

  /* ADDED: pre-fill WhatsApp support message with the real Payment ID
     (and name, if we have it) instead of a generic static message. */
  var waBtn = document.getElementById('tyWhatsappBtn');
  if (waBtn && paymentId && paymentId !== 'N/A') {
    var waText = 'Hi! I purchased the Flute Mastery course' +
      (name ? ' (Name: ' + name + ')' : '') +
      '. My Payment ID is ' + paymentId + '. I need help accessing my course.';
    waBtn.href = 'https://wa.me/918709268496?text=' + encodeURIComponent(waText);
  }

  /* Meta Pixel — Purchase (fires exactly once per paymentId, never on refresh) */
  if (paymentId && paymentId !== 'N/A') {
    var _fireKey = 'px_purchase_fired_' + paymentId;
    var _alreadyFired = false;
    try { _alreadyFired = !!sessionStorage.getItem(_fireKey); } catch (e) { /* ignore */ }

    if (!_alreadyFired) {
      try { sessionStorage.setItem(_fireKey, '1'); } catch (e) { /* ignore */ }
      /* Strip ?payment_id= from URL so refreshes cannot re-trigger */
      try {
        var _cleanUrl = window.location.pathname;
        window.history.replaceState(null, '', _cleanUrl);
      } catch (e) { /* ignore */ }

      /* CAPI FIX: apply manual Advanced Matching with the real checkout
         data before firing Purchase — this is a fresh page load, so the
         pixel has no user data yet unless we give it some here. */
      setPixelAdvancedMatching({ name: name, email: email, phone: phone });

      /* CAPI FIX: eventID passed via the 3rd param (options), not inside
         custom data — this is the field Meta actually reads to dedupe
         this Browser Purchase against the Server Purchase sent from
         Apps Script using the same Razorpay payment_id. */
      fbqTrack('Purchase', {
        value:          799,
        currency:       'INR',
        content_name:   COURSE_NAME,
        content_type:   'product',
        transaction_id: paymentId,
      }, { eventID: paymentId });
    }
  }
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
  var url = (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('YOUR_SCRIPT_ID'))
    ? null
    : GOOGLE_SCRIPT_URL;

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

/* ── PRODUCT CONFIG — Advanced Course & Bundle ─────────────────
   REPLACE the two GOOGLE_SCRIPT_URL placeholders below after you
   deploy the two new Apps Script backends (see setup guide).
   These are SEPARATE from GOOGLE_SCRIPT_URL above, which stays
   dedicated to the Beginner Course only. */
var PRODUCTS = {
  advanced: {
    key:            'advanced',
    name:           'Advanced Flute Mastery',
    amountPaise:    99900,        // ₹999
    price:          999,
    googleScriptUrl:'https://script.google.com/macros/s/AKfycbzzJV_yNFUwvlZYxE0YNzHJx_KXBjgNUp_9lxRvtUdnXoXLnTLICTq5GM0GSVRRIoug/exec', // ← REPLACE
    thankyouUrl:    'thankyou-advanced.html',
  },
  bundle: {
    key:            'bundle',
    name:           'Beginner + Advanced Flute Bundle',
    amountPaise:    160100,       // ₹1,601
    price:          1601,
    googleScriptUrl:'https://script.google.com/macros/s/AKfycbzCqUQJ_gd-_m8kjSQUksM3L-LEw4eFEey2SPlL5atozT1aiYF96rnlLyHTDxBS_0HW/exec', // ← REPLACE
    thankyouUrl:    'thankyou-bundle.html',
  },
};

/* Per-product transient state (mirrors _studentData/_rowToken pattern
   used by the Beginner flow, kept separate so nothing collides). */
var _productState = {
  advanced: { data: {}, rowToken: '' },
  bundle:   { data: {}, rowToken: '' },
};

/* ── Generic Modal Open/Close ──────────────────────────────── */
function openProductModal(productKey) {
  var product = PRODUCTS[productKey];
  if (!product) return;
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

/* ── Generic "save to sheet" for Advanced/Bundle — sends to
   whichever Apps Script URL belongs to that product. Mirrors the
   sendBeacon-first, fetch-keepalive-fallback pattern used by the
   Beginner Course's saveLeadToSheet(), so email/CAPI delivery is
   just as reliable across page-navigation on purchase. */
function saveLeadToSheetTo(url, data) {
  return new Promise(function (resolve) {
    if (!url || url.indexOf('PASTE_') !== -1) {
      console.warn('[Sheet] Apps Script URL not configured for this product — skipping sheet write.');
      resolve();
      return;
    }
    var payload = JSON.stringify(data);
    if (navigator.sendBeacon) {
      try {
        var blob = new Blob([payload], { type: 'text/plain' });
        if (navigator.sendBeacon(url, blob)) { resolve(); return; }
      } catch (e) { /* fall through to fetch */ }
    }
    fetch(url, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain' }, body: payload,
    }).then(function () { resolve(); }).catch(function (err) {
      console.error('[Sheet] Write failed:', err); resolve();
    });
  });
}

function handleProductSubmit(e, productKey) {
  e.preventDefault();
  if (!validateProductForm(productKey)) return;
  var suffix = capitalize_(productKey);
  var product = PRODUCTS[productKey];

  var name     = document.getElementById('enrollName' + suffix).value.trim();
  var email    = document.getElementById('enrollEmail' + suffix).value.trim();
  var whatsapp = document.getElementById('enrollWhatsapp' + suffix).value.trim();

  _productState[productKey].data = { name: name, email: email, phone: whatsapp };
  _productState[productKey].rowToken = 'row_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  setProductModalSubmitLoading(productKey, true);
  setProductModalStatus(productKey, 'Saving your details…', false);

  saveLeadToSheetTo(product.googleScriptUrl, {
    name: name, email: email, phone: whatsapp,
    paymentId: '', status: 'pending', amount: String(product.price),
    course: product.name, rowToken: _productState[productKey].rowToken,
  }).then(function () {
    setProductModalStatus(productKey, 'Opening secure payment…', false);
    setTimeout(function () {
      setProductModalSubmitLoading(productKey, false);
      closeProductModal(productKey);
      initiateProductPayment(productKey);
    }, 400);
  }).catch(function (err) {
    console.warn('[Sheet] Lead save failed, continuing to payment:', err);
    setProductModalStatus(productKey, '', false);
    setProductModalSubmitLoading(productKey, false);
    closeProductModal(productKey);
    initiateProductPayment(productKey);
  });
}

function initiateProductPayment(productKey) {
  var product = PRODUCTS[productKey];
  var state = _productState[productKey];
  if (!state.data.name) { openProductModal(productKey); return; }

  var options = {
    key: RAZORPAY_KEY_ID, // same Razorpay account/key as Beginner Course
    amount: product.amountPaise,
    currency: 'INR',
    name: BUSINESS_NAME,
    description: product.name,
    image: LOGO_URL,
    prefill: {
      name: state.data.name || '', email: state.data.email || '', contact: state.data.phone || '',
    },
    notes: {
      product: product.name, student_name: state.data.name || '', student_email: state.data.email || '',
    },
    theme: { color: '#C9922A' },
    modal: {
      ondismiss: function () {
        console.log('[Razorpay] Checkout dismissed (' + productKey + ')');
        state.data = {}; state.rowToken = '';
      },
    },
    handler: function (response) {
      var paymentId = response.razorpay_payment_id;
      var orderId   = response.razorpay_order_id || '';

      try {
        sessionStorage.setItem('rzp_payment_id_' + productKey, paymentId);
        sessionStorage.setItem('rzp_student_name_'  + productKey, state.data.name  || '');
        sessionStorage.setItem('rzp_student_email_' + productKey, state.data.email || '');
        sessionStorage.setItem('rzp_student_phone_' + productKey, state.data.phone || '');
      } catch (e) { /* ignore */ }

      saveLeadToSheetTo(product.googleScriptUrl, {
        name: state.data.name || '', email: state.data.email || '', phone: state.data.phone || '',
        phoneNormalized: normalizePhoneForMatching(state.data.phone),
        paymentId: paymentId, orderId: orderId, status: 'paid',
        amount: String(product.price), course: product.name, rowToken: state.rowToken,
        fbp: getCookie('_fbp'), fbc: getCookie('_fbc'),
        eventSourceUrl: window.location.origin + '/' + product.thankyouUrl,
        clientUserAgent: navigator.userAgent || '',
      }).catch(function (err) { console.error('[Sheet] Payment update failed (' + productKey + '):', err); });

      window.location.href = product.thankyouUrl + '?payment_id=' + encodeURIComponent(paymentId);
    },
  };

  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function (response) {
    console.error('[Razorpay] Payment failed (' + productKey + '):', response.error);
    alert('Payment failed: ' + (response.error.description || 'Unknown error') + '. Please try again or WhatsApp us at +91 87092 68496.');
  });
  rzp.open();
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
