/* ============================================================
   FLUTE MASTERY — script.js
   Handles: Nav, FAQ, Razorpay, Meta Pixel, Scroll Animations
   ============================================================ */

'use strict';

/* ── Meta Pixel Helper ─────────────────────────────────────── */
function fbqTrack(event, data) {
  if (typeof fbq === 'function') {
    fbq('track', event, data || {});
  }
}

/* ── Razorpay Payment ──────────────────────────────────────── */
/*
  ============================================================
  RAZORPAY SETUP INSTRUCTIONS:
  1. Go to https://dashboard.razorpay.com and create an account.
  2. Go to Settings > API Keys > Generate Key.
  3. Copy your "Key ID" and paste it below as RAZORPAY_KEY_ID.
  4. Replace all placeholder values below with your actual details.
  ============================================================
*/

const RAZORPAY_KEY_ID = 'rzp_test_SdLEnL0lYIFFpw'; // <-- REPLACE with your Razorpay Key ID
const COURSE_AMOUNT   = 69900; // Amount in paise (₹699 = 69900 paise)
const COURSE_NAME     = 'Flute Mastery — Complete Course';
const BUSINESS_NAME   = 'Flute Mastery';
const LOGO_URL        = ''; // Optional: URL to your logo image (hosted online)
const WHATSAPP_NUM    = '919999999999'; // <-- REPLACE with your WhatsApp number (no +, no spaces)
const THANKYOU_URL    = 'thankyou.html'; // Relative URL of thank you page

/* Google Apps Script Web App URL (see setup guide for how to get this) */
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec'; // <-- REPLACE

function initiatePayment() {
  /* Fire Meta Pixel — InitiateCheckout */
  fbqTrack('InitiateCheckout', {
    value: 699,
    currency: 'INR',
    content_name: COURSE_NAME,
    content_type: 'product',
  });

  const options = {
    key: RAZORPAY_KEY_ID,
    amount: COURSE_AMOUNT,
    currency: 'INR',
    name: BUSINESS_NAME,
    description: COURSE_NAME,
    image: LOGO_URL,

    /* Prefill — leave blank, Razorpay will ask the user */
    prefill: {
      name: '',
      email: '',
      contact: '',
    },

    notes: {
      product: COURSE_NAME,
    },

    theme: {
      color: '#C9922A',
    },

    modal: {
      ondismiss: function () {
        console.log('[Razorpay] Checkout dismissed');
      },
    },

    handler: function (response) {
      /* Payment successful */
      const paymentId = response.razorpay_payment_id;

      /* Store the payment data temporarily for the thank you page */
      try {
        sessionStorage.setItem('rzp_payment_id', paymentId);
      } catch (e) { /* ignore */ }

      /* Fire Meta Pixel — Purchase */
      fbqTrack('Purchase', {
        value: 699,
        currency: 'INR',
        content_name: COURSE_NAME,
        content_type: 'product',
        transaction_id: paymentId,
      });

      /* Send data to Google Apps Script (to save in Google Sheets + send email) */
      sendToGoogleScript({
        paymentId: paymentId,
        /* These will be populated if Razorpay passes them back */
      });

      /* Redirect to Thank You page */
      window.location.href = THANKYOU_URL + '?payment_id=' + encodeURIComponent(paymentId);
    },
  };

  const rzp = new Razorpay(options);

  rzp.on('payment.failed', function (response) {
    console.error('[Razorpay] Payment failed:', response.error);
    alert('Payment failed. Please try again or contact us on WhatsApp.');
  });

  rzp.open();
}

/* ── Google Apps Script Integration ───────────────────────── */
function sendToGoogleScript(data) {
  /*
    This sends payment data to your Google Apps Script Web App.
    The script will:
    1. Save data to Google Sheets
    2. Send a confirmation email to the customer
    See google-apps-script.gs for the full script.
  */
  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) {
    console.warn('[Google Script] URL not configured. Skipping.');
    return;
  }

  fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors', /* Google Apps Script requires no-cors */
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentId: data.paymentId || '',
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      timestamp: new Date().toISOString(),
      amount: '699',
      course: COURSE_NAME,
    }),
  }).catch(function (err) {
    console.error('[Google Script] Error:', err);
  });
}

/* ── Navigation ────────────────────────────────────────────── */
(function initNav() {
  const nav        = document.getElementById('mainNav');
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  if (!nav) return;

  /* Scroll behaviour */
  function onScroll() {
    if (window.scrollY > 60) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Hamburger toggle */
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    /* Close on link click */
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
  const item = questionEl.closest('.faq-item');
  const isOpen = item.classList.contains('open');

  /* Close all */
  document.querySelectorAll('.faq-item').forEach(function (el) {
    el.classList.remove('open');
    el.querySelector('.faq-question').setAttribute('aria-expanded', false);
  });

  /* Open clicked (if it wasn't already open) */
  if (!isOpen) {
    item.classList.add('open');
    questionEl.setAttribute('aria-expanded', true);
  }
}

/* Keyboard accessibility for FAQ */
document.querySelectorAll('.faq-question').forEach(function (el) {
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFaq(el);
    }
  });
});

/* ── Scroll Reveal Animation ───────────────────────────────── */
(function initReveal() {
  const els = document.querySelectorAll('[data-reveal]');
  if (!els.length) return;

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  els.forEach(function (el) { observer.observe(el); });
})();

/* ── Thank You Page ────────────────────────────────────────── */
(function initThankYou() {
  if (!document.getElementById('tyPaymentId')) return;

  /* Read payment ID from URL */
  const params    = new URLSearchParams(window.location.search);
  const paymentId = params.get('payment_id') ||
                    (() => { try { return sessionStorage.getItem('rzp_payment_id'); } catch(e){ return ''; } })() ||
                    'N/A';

  const idEl = document.getElementById('tyPaymentId');
  if (idEl) idEl.textContent = paymentId;

  /* Fire Meta Pixel Purchase if coming from Razorpay redirect */
  if (params.get('payment_id')) {
    fbqTrack('Purchase', {
      value: 699,
      currency: 'INR',
      content_name: COURSE_NAME,
      content_type: 'product',
      transaction_id: paymentId,
    });
  }
})();

/* ── Smooth Scroll for anchor links ───────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ── ViewContent on video section visible ──────────────────── */
(function trackVideoView() {
  const videoSection = document.getElementById('free-lesson');
  if (!videoSection) return;
  let tracked = false;
  const obs = new IntersectionObserver(function (entries) {
    if (!tracked && entries[0].isIntersecting) {
      fbqTrack('ViewContent', {
        content_name: 'Free First Lesson Video',
        content_type: 'video',
      });
      tracked = true;
      obs.disconnect();
    }
  }, { threshold: 0.5 });
  obs.observe(videoSection);
})();
