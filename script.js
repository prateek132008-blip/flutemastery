/* ============================================================
   FLUTE MASTERY — script.js  (v4 — QR + WhatsApp payment)
   Handles: Enrollment Modal, Nav, FAQ, QR/WhatsApp Payment,
            Meta Pixel, Google Apps Script, Scroll Animations
   ============================================================ */

'use strict';

/* ── CONFIGURATION ─────────────────────────────────────────── */
var COURSE_NAME       = 'Flute Mastery — Complete Course';
var BUSINESS_NAME     = 'Flute Mastery';
var WHATSAPP_NUM      = '918709268496'; // ← REPLACE with your WhatsApp number to change it everywhere it's used from config
var PIXEL_ID          = '1001951225815875';

/*
  Google Apps Script Web App URL.
  After deploying your Apps Script (see google-apps-script.gs),
  paste the generated URL here.
*/
var GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxwwdNOQYboWXY5b7QMB8Yj2GDylwTH3OyY4Cdz1f4h-55F-MFUCaYN6KzMhxMMZi3SVQ/exec'; // ← REPLACE

/* ── Meta Pixel Helper ─────────────────────────────────────── */
function fbqTrack(event, data) {
  if (typeof fbq === 'function') {
    fbq('track', event, data || {});
  }
}

/* ── Enrollment Modal ──────────────────────────────────────── */
/*
  Step 1 of the modal collects Name, Email, and WhatsApp and saves
  the lead to Google Sheets (status = "pending") — unchanged from
  before. Step 2 then shows the UPI QR code, payment instructions,
  and a WhatsApp button for manual payment verification.
*/

var _studentData = {}; // holds form data collected in step 1

// FIX: A unique token generated at form-submit time. This lets Apps
// Script reliably match sheet rows without relying on email alone.
var _rowToken = '';

function openEnrollmentModal() {
  fbqTrack('InitiateCheckout', {
    value: 699,
    currency: 'INR',
    content_name: COURSE_NAME,
    content_type: 'product',
  });
  var overlay = document.getElementById('enrollModal');
  if (!overlay) return;
  showEnrollStep(1);
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(function () {
    var first = overlay.querySelector('#modalStep1 input');
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
  showEnrollStep(1);
}

/* Switch between step 1 (lead form) and step 2 (QR + WhatsApp payment) */
function showEnrollStep(stepNumber) {
  var step1 = document.getElementById('modalStep1');
  var step2 = document.getElementById('modalStep2');
  if (!step1 || !step2) return;
  if (stepNumber === 2) {
    step1.style.display = 'none';
    step2.style.display = 'block';
  } else {
    step2.style.display = 'none';
    step1.style.display = 'block';
  }
}

/* Keyboard: Escape closes modal */
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeEnrollmentModal();
});

/* Click outside modal box closes it */
document.addEventListener('click', function (e) {
  var overlay = document.getElementById('enrollModal');
  if (overlay && e.target === overlay) closeEnrollmentModal();
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
    amount:    '699',
    course:    COURSE_NAME,
    rowToken:  _rowToken,
  })
  .then(function () {
    setModalSubmitLoading(false);
    setModalStatus('', false);
    showEnrollStep(2);
  })
  .catch(function (err) {
    /* If sheet save fails, still show the QR payment step — don't block payment */
    console.warn('[Sheet] Lead save failed, continuing to payment:', err);
    setModalSubmitLoading(false);
    setModalStatus('', false);
    showEnrollStep(2);
  });
}

/* ── Save Lead / Update Row in Google Sheets ───────────────── */
function saveLeadToSheet(data) {
  return new Promise(function (resolve, reject) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) {
      console.warn('[Sheet] GOOGLE_SCRIPT_URL not configured — skipping sheet write.');
      resolve();
      return;
    }
    fetch(GOOGLE_SCRIPT_URL, {
      method:  'POST',
      mode:    'no-cors', /* GAS requires no-cors */
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(data),
    })
    .then(function () { resolve(); }) /* no-cors response is opaque — always resolve */
    .catch(function (err) { reject(err); });
  });
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
    (function () { try { return sessionStorage.getItem('student_payment_id'); } catch (e) { return ''; } })() || 'N/A';
  var name = (function () { try { return sessionStorage.getItem('student_name'); } catch (e) { return ''; } })() || '';

  var idEl   = document.getElementById('tyPaymentId');
  var nameEl = document.getElementById('tyStudentName');
  if (idEl)   idEl.textContent   = paymentId;
  if (nameEl && name) nameEl.textContent = name;

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
      fbqTrack('Purchase', {
        value:          699,
        currency:       'INR',
        content_name:   COURSE_NAME,
        content_type:   'product',
        transaction_id: paymentId,
      });
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
