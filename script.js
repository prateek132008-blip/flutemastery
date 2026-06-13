/* ============================================================
   FLUTE MASTERY — script.js  (v3 — duplicate fix)
   Handles: Enrollment Modal, Nav, FAQ, Razorpay, Meta Pixel,
            Google Apps Script, Scroll Animations
   ============================================================ */

'use strict';

/* ── CONFIGURATION ─────────────────────────────────────────── */
var RAZORPAY_KEY_ID   = 'rzp_live_Sczvk68iCuryMo'; // ← REPLACE with your Razorpay Key ID
var COURSE_AMOUNT     = 69900;                         // paise (₹699)
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
var GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyPCal7nn6-Bv-HnF71-_upZ_hBVzcklZs5BOYXoKDaKweRj2055MDjFmJSxkx0HMUJKQ/exec'; // ← REPLACE

/* ── Meta Pixel Helper ─────────────────────────────────────── */
function fbqTrack(event, data) {
  if (typeof fbq === 'function') {
    fbq('track', event, data || {});
  }
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
    value: 699,
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
      } catch (e) { /* ignore */ }

      /* Step 3 — Update sheet row with payment confirmation + trigger email.
         FIX: Pass the same rowToken so Apps Script matches the correct row.
         Redirect happens after a short delay to give the fetch time to fire,
         but we do NOT await it — payment is already confirmed by Razorpay. */
      saveLeadToSheet({
        name:      _studentData.name  || '',
        email:     _studentData.email || '',
        phone:     _studentData.phone || '',
        paymentId: paymentId,
        orderId:   orderId,
        status:    'paid',
        amount:    '699',
        course:    COURSE_NAME,
        rowToken:  _rowToken,
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
    (function () { try { return sessionStorage.getItem('rzp_payment_id'); } catch (e) { return ''; } })() || 'N/A';
  var name = (function () { try { return sessionStorage.getItem('rzp_student_name'); } catch (e) { return ''; } })() || '';

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
