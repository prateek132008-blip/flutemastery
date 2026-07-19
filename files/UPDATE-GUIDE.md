# Flute Mastery — Update Guide

Everything below documents what was changed, why, and how to configure/deploy it. Your legal pages, branding, and business content were **not** altered beyond the price and one clarifying number.

---

## 1. Files Modified

| File | What changed |
|---|---|
| `index.html` | Price ₹699→₹799 everywhere · autoplaying muted hero video · new Trust/UDYAM section + view-only modal · gated "Need Help?" WhatsApp flow (replaces instant WA float) · **new "Meet Your Teacher" section with photo + self-hosted video + bio/stats** · Course structured data (SEO) · extra OG/Twitter tags · speed preconnects |
| `script.js` | Price constants updated (₹799 / 79900 paise) · hero video mute/unmute control · Need Help modal logic + WhatsApp handoff · UDYAM modal logic · generalized Escape/outside-click handling for all modals |
| `style.css` | Styles for hero video, Trust/UDYAM section, Need Help modal · mobile fix so the hero video still shows on phones |
| `contact.html` | Price ₹699→₹799 in nav CTA |
| `terms-and-conditions.html` | Price ₹699→₹799 in Payment clause |
| `privacy-policy.html`, `refund-policy.html`, `course-delivery.html`, `thankyou.html`, `robots.txt`, `sitemap.xml` | **Unchanged** — no price or legal content in these needed updating |
| `assets/udyam-certificate.svg` | New placeholder — replace with your real certificate (see §6) |
| `assets/teacher-photo.jpg` | New placeholder (800×1000px) — replace with your real photo (see §6) |
| `assets/teacher-intro.mp4` | New placeholder clip — replace with your uploaded video (see §6) |

Nothing was rebuilt from scratch — your existing Razorpay flow, Google Sheets logging, Meta Pixel, FAQ, testimonials, and curriculum content are all intact.

---

## 2. What Changed and Why (CRO reasoning)

- **Price → ₹799 everywhere**, including the modal, hero, pricing card, nav CTA, testimonials copy, Terms page, and Razorpay amount (`COURSE_AMOUNT`) and Meta Pixel `value` fields, so pixel-reported revenue stays accurate. Savings/discount text was recalculated (₹1,700 / 68% off vs the ₹2,499 anchor).
- **Autoplaying muted hero video**: browsers block unmuted autoplay, so it starts muted with a one-tap "🔊 Sound on" button (uses YouTube's postMessage command, no extra library). This puts the strongest asset — your teaching on camera — in front of every visitor before they read a word, which typically lifts both trust and time-on-page.
- **Trust/UDYAM section**: adds a dedicated, scannable proof block (government registration, secure payments) plus a **view-only** certificate modal — `img` has `draggable="false"` and `oncontextmenu="return false"`, and there is no download link or `download` attribute anywhere near it.
- **Gated "Need Help?" flow**: replaces the instant WhatsApp float. Visitors first see pricing/audience/delivery/refund answers and a direct "Enroll Now" CTA; only after that does a WhatsApp button appear. This is still one tap away — never hidden — but it pre-qualifies visitors and answers the questions that generate most low-intent chats.
- **Course structured data + extra meta tags**: improves how the page can appear in search/social previews; no visible on-page change.

---

## 3. Razorpay Integration Guide

Your site already uses **Razorpay Checkout (client-side)**, which is the standard approach for a static/no-backend site like this.

1. Log in to the [Razorpay Dashboard](https://dashboard.razorpay.com) → **Settings → API Keys**.
2. Generate/copy your **Live Key ID** (`rzp_live_...`).
3. In `script.js`, set:
   ```js
   var RAZORPAY_KEY_ID = 'rzp_live_XXXXXXXXXXXX'; // your Key ID
   var COURSE_AMOUNT   = 79900; // amount in paise = ₹799 × 100
   ```
4. **Never put your Key *Secret* in this file** — only the Key *ID* belongs in client-side code. The secret is only needed server-side (e.g., inside a Google Apps Script or a small backend) if you later add server-side payment signature verification.
5. Test with Razorpay's **Test Mode** keys (`rzp_test_...`) and their [test card/UPI details](https://razorpay.com/docs/payments/payments/test-card-upi-details/) before going live.

**Note on security:** this flow trusts the `handler` callback after Razorpay's popup succeeds — it does not verify the payment signature server-side. This is common for simple digital-delivery sites but means a technically sophisticated user could theoretically fake a "success" callback without paying. If you want this closed, you'd need a small server (or a Google Apps Script `doPost` that calls Razorpay's Payments API with your **Key Secret**) to verify `razorpay_payment_id` + `razorpay_signature` before granting access. Ask if you'd like this added.

---

## 4. Google Apps Script Setup Guide

Your site already posts to a Google Apps Script Web App URL (`GOOGLE_SCRIPT_URL` in `script.js`) for both the enrollment form and the contact form.

1. Open [Google Sheets](https://sheets.google.com) → create a new sheet, e.g. **"Flute Mastery — Orders"**.
2. Add header row: `Timestamp | Name | Email | Phone | Amount | Course | Payment ID | Order ID | Status | Source | RowToken`
3. In the sheet: **Extensions → Apps Script**. Paste a script that:
   - On `doPost(e)`, parses `JSON.parse(e.postData.contents)`.
   - If `status === 'pending'`, appends a new row with the lead data and the `rowToken`.
   - If `status === 'paid'`, finds the row matching `rowToken` and updates it with `paymentId`, `orderId`, and `status = 'paid'`.
   - Optionally sends a confirmation email (Drive link + PDF) using `MailApp.sendEmail(...)`.
4. Click **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the generated **Web app URL** and paste it into `script.js`:
   ```js
   var GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
   ```
6. Re-deploy (Deploy → Manage deployments → Edit → New version) every time you change the script — the URL stays the same, but old versions won't pick up code changes otherwise.

---

## 5. Google Sheets Automation — What Gets Logged

Every enrollment writes/updates one row with: Name, Email, Phone, Amount Paid, Course Purchased, Payment ID, Order ID, Payment Status (`pending` → `paid`), Timestamp, and a `rowToken` used to match the two writes to the same row. Add a `Source` column in your Apps Script if you want to tag traffic (e.g. from a `?src=` URL parameter) — this isn't wired up yet but is a small addition if you want it.

---

## 6. How to Update Things Later

**Course price:**
Update these two places — everything else derives from them:
- `script.js`: `COURSE_AMOUNT` (in paise, e.g. `89900` for ₹899) and the three `699`/`799`-style numeric fields used for Pixel tracking (`value:` and `amount:` fields).
- Then find-and-replace the `₹799` text across `index.html`, `contact.html`, and `terms-and-conditions.html`.

**Hero/intro YouTube video:**
In `index.html`, find `id="heroVideoFrame"` and replace `UM5jeycaJ8w` in the `src` URL **and** in the `playlist=` parameter (both must match for looping to work) with your new video's ID.

**WhatsApp number:**
In `script.js`, update `WHATSAPP_NUM = '91XXXXXXXXXX'` (country code + number, no `+` or spaces). This single constant drives the Need Help modal and the contact form fallback. Also update the direct `wa.me` links in `thankyou.html`, `contact.html`, and the legal pages' support sections.

**UDYAM number:**
In `index.html`, search for `UDYAM-XX-00-0000000` (appears once in the Trust section) and replace with your real number. Then replace `assets/udyam-certificate.svg` with a photo/scan of your actual certificate (jpg/png/svg all work — just update the `<img src>` in the `#udyamModal` block to match your filename).

**Teacher photo:**
Replace `assets/teacher-photo.jpg` with your real photo at the **exact same filename**, or update the two `src="assets/teacher-photo.jpg"` references in the `#teacher` section of `index.html` (the `<img>` and the video's `poster`) to your new filename.
- **Recommended exact size: 800 × 1000px (4:5 portrait ratio)**
- Format: JPG or WebP, ideally under ~250KB for fast loading
- Half-body or shoulders-up shot, good lighting, ideally holding/playing the flute

**Teacher intro video:**
Replace `assets/teacher-intro.mp4` with your uploaded video at the same filename, or update the `<source src="assets/teacher-intro.mp4">` in the `#teacher` section.
- Format: MP4 (H.264 codec) for the widest browser support
- Resolution: 1080p or 720p
- Length: 30–90 seconds works best for an intro (keeps file size/load time down)
- Size: compress to roughly 40–60MB or under if possible — large files will load slowly on mobile data. Tools like [HandBrake](https://handbrake.fr/) (free) can compress this easily.
- The video uses `preload="none"` so it won't load until the visitor taps play — this keeps the page fast even with a larger file.

**Razorpay keys:** see §3 above.

---

## 7. Deployment Guide

This is a static site — no build step required.

1. Upload all files (keeping the folder structure, including `assets/`) to your host — e.g. Netlify, Vercel, GitHub Pages, or your existing `fluteroom.store` hosting.
2. Make sure `index.html` is the root file served at `/`.
3. Confirm HTTPS is enabled (required for Razorpay Checkout).
4. Verify `robots.txt` and `sitemap.xml` are reachable at `/robots.txt` and `/sitemap.xml`.
5. Submit `sitemap.xml` in [Google Search Console](https://search.google.com/search-console).

---

## 8. Environment Variables / API Keys Required

| Key | Where it goes | Notes |
|---|---|---|
| Razorpay Key ID | `script.js` → `RAZORPAY_KEY_ID` | Public, safe client-side |
| Razorpay Key Secret | **Not in this codebase** | Only needed if you add server-side signature verification |
| Google Apps Script Web App URL | `script.js` → `GOOGLE_SCRIPT_URL` | Public endpoint, but only accepts your expected payload shape |
| Meta Pixel ID | Already set to `1001951225815875` in `index.html`, `contact.html`, `thankyou.html` | Update in all three if you switch pixels |

There's no `.env` file since this is a static site with no server — all values above are plain constants in the front-end files.

---

## 9. Testing Checklist

- [ ] Enrollment modal opens from nav, hero, pricing card, and CTA banner
- [ ] Form validation rejects invalid name/email/phone
- [ ] Razorpay Checkout opens with correct amount (₹799) and pre-filled details
- [ ] Test-mode payment completes → redirects to `thankyou.html?payment_id=...`
- [ ] Thank-you page shows the Payment ID and working Drive/PDF/WhatsApp links
- [ ] Google Sheet receives a `pending` row on modal submit and updates to `paid` after payment
- [ ] Meta Pixel fires `InitiateCheckout` on modal open and `Purchase` once (not on refresh) on thank-you
- [ ] Hero video autoplays muted; tapping "🔊 Sound on" unmutes it
- [ ] Trust section's "Click to View Registration" opens the modal; right-click/drag on the image is blocked; there is no download link
- [ ] "Need Help?" button opens the FAQ popup; WhatsApp button opens `wa.me` with a pre-filled message
- [ ] Contact form submits (or falls back to WhatsApp if no Apps Script URL is configured)
- [ ] All footer/legal links work: Privacy, Terms, Refund, Course Delivery

## 10. Mobile Testing Checklist

- [ ] Hero video is visible and plays on a real phone (not just desktop devtools)
- [ ] Hamburger menu opens/closes and links scroll correctly
- [ ] Enrollment modal, Need Help modal, and UDYAM modal all fit the viewport and scroll internally if needed
- [ ] Razorpay Checkout renders correctly on mobile Chrome/Safari
- [ ] Trust badges wrap cleanly; UDYAM card stacks vertically
- [ ] "Need Help?" floating button doesn't overlap other fixed elements

## 11. Deployment Checklist

- [ ] Live Razorpay keys in place (not test keys)
- [ ] Google Apps Script deployed as a **new version** after any script edit
- [ ] `robots.txt` sitemap URL matches your real domain
- [ ] `og:image` (`https://fluteroom.store/og-image.jpg`) actually exists at that path
- [ ] Real UDYAM certificate image uploaded, replacing the placeholder SVG
- [ ] Real WhatsApp number confirmed in every location (§6)
- [ ] HTTPS active site-wide

## 12. Security Checklist

- [ ] Only the Razorpay **Key ID** is in client code — never the Key Secret
- [ ] Google Apps Script deployment access is scoped appropriately (Anyone can call it, but it should only *write*, not expose your sheet for reading)
- [ ] Consider adding Razorpay signature verification (§3) if fraud risk matters to you
- [ ] UDYAM certificate is view-only (no download link/attribute present)
- [ ] `noindex` remains on `thankyou.html` and legal pages where already set

---

## 13. Troubleshooting

**Payment succeeds but no Sheet row appears** — Check `GOOGLE_SCRIPT_URL` is deployed with "Anyone" access and that you redeployed after any script changes (the URL doesn't change, but old code keeps running until you do).

**Hero video doesn't autoplay on iPhone Safari** — Confirm the `mute=1` and `playsinline=1` params are still in the iframe `src`; iOS requires both for inline autoplay.

**Unmute button does nothing** — Requires `enablejsapi=1` in the video URL (already included); some ad-blockers block YouTube's postMessage API — this is a known edge case.

**Razorpay popup doesn't open** — Check the browser console for a blocked/failed `checkout.js` load (ad-blockers sometimes block it) and confirm `RAZORPAY_KEY_ID` is set correctly.

**UDYAM image doesn't load** — Confirm `assets/udyam-certificate.svg` (or your replacement file) was uploaded alongside the HTML/CSS/JS files, and that the `<img src>` path matches the actual filename.

**Contact form always falls back to WhatsApp** — This is expected until you set a real `GOOGLE_SCRIPT_URL` (or Formspree endpoint) in `contact.html`'s inline script and `script.js`.
