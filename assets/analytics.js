// Google Analytics 4 with Consent Mode v2. Consent defaults to denied; a
// one-time banner flips analytics_storage to granted only if the visitor
// accepts (remembered in localStorage). Advertising signals stay denied.

const GA_ID = "G-NVQNT18PGN";
const STORAGE_KEY = "wado-analytics-consent";

const doNotTrack = navigator.doNotTrack === "1" || window.doNotTrack === "1";
if (!doNotTrack) init();

function init() {
  window.dataLayer = window.dataLayer || [];
  const gtag = (...args) => window.dataLayer.push(args);
  window.gtag = gtag;

  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (e.g. private mode) — treat as undecided.
  }

  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: stored === "granted" ? "granted" : "denied",
    wait_for_update: 500,
  });

  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.append(tag);

  gtag("js", new Date());
  gtag("config", GA_ID);

  if (stored !== "granted" && stored !== "denied") showBanner(gtag);
}

function persist(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Non-fatal: the visitor will just be asked again next time.
  }
}

function showBanner(gtag) {
  const style = document.createElement("style");
  style.textContent = `
    #wado-consent {
      position: fixed; left: 1rem; right: 1rem; bottom: 1rem; z-index: 9999;
      max-width: 640px; margin: 0 auto; background: #fff; color: #1a1a1a;
      border: 1px solid #e4ddd0; border-radius: 6px;
      box-shadow: 0 6px 24px rgba(26, 26, 26, .14);
      padding: 1rem 1.15rem; display: flex; flex-wrap: wrap;
      align-items: center; gap: .75rem 1rem;
      font-family: "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP",
                   "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      font-size: 14px; line-height: 1.6;
    }
    #wado-consent p { margin: 0; flex: 1 1 260px; color: #3d3a33; }
    #wado-consent a { color: #7a1c1c; }
    #wado-consent .wc-actions { display: flex; gap: .5rem; flex: 0 0 auto; }
    #wado-consent button {
      font: inherit; font-size: 13px; cursor: pointer;
      padding: .4rem .9rem; border-radius: 4px;
      border: 1px solid #7a1c1c; background: #fff; color: #7a1c1c;
    }
    #wado-consent button.wc-accept { background: #7a1c1c; color: #fff; }
    #wado-consent button:hover { opacity: .88; }
  `;
  document.head.append(style);

  const banner = document.createElement("div");
  banner.id = "wado-consent";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Analytics consent");
  banner.innerHTML = `
    <p>We use Google Analytics to understand traffic. Cookies are only set if you
    accept. See our <a href="/privacy.html">privacy note</a>.</p>
    <div class="wc-actions">
      <button type="button" class="wc-decline">Decline</button>
      <button type="button" class="wc-accept">Accept</button>
    </div>
  `;
  document.body.append(banner);

  banner.querySelector(".wc-accept").addEventListener("click", () => {
    gtag("consent", "update", { analytics_storage: "granted" });
    persist("granted");
    banner.remove();
  });
  banner.querySelector(".wc-decline").addEventListener("click", () => {
    persist("denied");
    banner.remove();
  });
}
