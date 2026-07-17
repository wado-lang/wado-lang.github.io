/*
 * Google Analytics 4 (gtag.js) with Consent Mode v2.
 *
 * Shared across the whole site: the landing page, the generated blog/docs
 * pages (src/template.wado), and the playground. Loaded early in <head> as
 * `<script src="/assets/analytics.js"></script>`.
 *
 * To activate: replace GA_MEASUREMENT_ID below with the real GA4 measurement
 * id (the "G-XXXXXXXXXX" value from Admin -> Data streams). While it is left
 * as the placeholder, nothing loads and no requests are made.
 *
 * Behaviour: consent defaults to denied for every storage type. A small
 * banner asks the visitor; only "Accept" flips analytics_storage to granted
 * and lets GA set cookies. The choice is remembered in localStorage, so the
 * banner shows once. Advertising signals stay denied regardless.
 */
(function () {
  "use strict";

  var GA_MEASUREMENT_ID = "G-XXXXXXXXXX";
  var STORAGE_KEY = "wado-analytics-consent";

  // Not configured yet: do nothing so a placeholder id never ships live.
  if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID === "G-XXXXXXXXXX") return;

  // Respect an explicit browser Do-Not-Track signal.
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode */ }

  // Consent Mode v2 — everything denied by default; analytics restored if the
  // visitor previously accepted. gtag.js queues hits until consent updates.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: stored === "granted" ? "granted" : "denied",
    wait_for_update: 500
  });

  // Load gtag.js and configure the stream.
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
  document.head.appendChild(s);

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);

  // Decision already made — no banner.
  if (stored === "granted" || stored === "denied") return;

  function persist(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* ignore */ }
  }

  function showBanner() {
    if (document.getElementById("wado-consent")) return;

    var style = document.createElement("style");
    style.textContent =
      '#wado-consent{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:9999;' +
      'max-width:640px;margin:0 auto;background:#fff;color:#1a1a1a;' +
      'border:1px solid #e4ddd0;border-radius:6px;' +
      'box-shadow:0 6px 24px rgba(26,26,26,.14);' +
      'padding:1rem 1.15rem;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1rem;' +
      'font-family:"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;' +
      'font-size:14px;line-height:1.6;}' +
      '#wado-consent p{margin:0;flex:1 1 260px;color:#3d3a33;}' +
      '#wado-consent a{color:#7a1c1c;}' +
      '#wado-consent .wc-actions{display:flex;gap:.5rem;flex:0 0 auto;}' +
      '#wado-consent button{font:inherit;font-size:13px;cursor:pointer;' +
      'padding:.4rem .9rem;border-radius:4px;border:1px solid #7a1c1c;background:#fff;color:#7a1c1c;}' +
      '#wado-consent button.wc-accept{background:#7a1c1c;color:#fff;}' +
      '#wado-consent button:hover{opacity:.88;}';
    document.head.appendChild(style);

    var banner = document.createElement("div");
    banner.id = "wado-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Analytics consent");
    banner.innerHTML =
      '<p>We use Google Analytics to understand traffic. Cookies are only set ' +
      'if you accept. See our <a href="/privacy.html">privacy note</a>.</p>' +
      '<div class="wc-actions">' +
      '<button type="button" class="wc-decline">Decline</button>' +
      '<button type="button" class="wc-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(banner);

    function close() { banner.remove(); }

    banner.querySelector(".wc-accept").addEventListener("click", function () {
      gtag("consent", "update", { analytics_storage: "granted" });
      persist("granted");
      close();
    });
    banner.querySelector(".wc-decline").addEventListener("click", function () {
      persist("denied");
      close();
    });
  }

  if (document.body) {
    showBanner();
  } else {
    document.addEventListener("DOMContentLoaded", showBanner);
  }
})();
