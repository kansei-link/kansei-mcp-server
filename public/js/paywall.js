/**
 * KanseiLink Paywall — server-enforced premium content loader.
 *
 * Articles contain EMPTY placeholders:
 *   <div data-tier="pro" data-premium-id="insights/some-article"></div>
 * The premium HTML is NOT in the static page (the repo and Pages are public);
 * it lives in the KanseiLink API DB and is fetched here for subscribers:
 *   GET /api/premium?article=<id>&email=<email>&token=<access-token>
 *
 * Credentials (localStorage):
 *   kl_email — subscriber email
 *   kl_token — per-email access token, issued ONLY by:
 *     - /api/access-token after Stripe checkout (subscription/success.html), or
 *     - magic-link sign-in (subscription/login.html)
 *
 * Adding new gated articles: wrap the section with data-tier, then run
 *   node scripts/extract-premium-sections.mjs && node scripts/upload-premium-content.mjs
 */
(function () {
  "use strict";

  var API_BASE = window.KANSEI_API_BASE || "https://kansei-link-mcp-production-b054.up.railway.app";
  var STORAGE_KEY = "kl_email";
  var TOKEN_KEY = "kl_token";

  // Detect language from <html lang="...">
  var lang = (document.documentElement.lang || "ja").startsWith("en") ? "en" : "ja";
  var LOGIN_PATH = lang === "en" ? "/en/subscription/login.html" : "/subscription/login.html";
  var PRICING_PATH = lang === "en" ? "/en/pricing.html" : "/pricing.html";

  var TIER_LABELS = {
    ja: {
      pro: { badge: "Pro", title: "Pro プランで全文を読む", desc: "Agent Voice詳細、レシピ成功率、gotchas、GPT/Claude/Gemini比較が見放題。", cta: "Pro プランに登録（$19/月）", login: "登録済みの方はログイン" },
      team: { badge: "Team", title: "Team プランで詳細レポートを見る", desc: "指定サービスの詳細レポート、競合比較、AXR推移、Agent Voice生データにアクセス。", cta: "Team プランに登録（$149/月）", login: "登録済みの方はログイン" },
      upgrade: "プランのアップグレードが必要です",
      error: "コンテンツを読み込めませんでした。再読み込みしてください。"
    },
    en: {
      pro: { badge: "Pro", title: "Read the full article with Pro", desc: "Unlock Agent Voice details, recipe success rates, gotchas, and GPT/Claude/Gemini comparison.", cta: "Subscribe to Pro ($19/mo)", login: "Already subscribed? Sign in" },
      team: { badge: "Team", title: "Access detailed reports with Team", desc: "Per-service detailed reports, competitive analysis, AXR trends, and raw Agent Voice data.", cta: "Subscribe to Team ($149/mo)", login: "Already subscribed? Sign in" },
      upgrade: "A plan upgrade is required for this section",
      error: "Could not load this section. Please reload the page."
    }
  };

  function getEmail() {
    return localStorage.getItem(STORAGE_KEY) || "";
  }
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  // ─── CTA card (rendered INSIDE the empty placeholder) ───
  function renderCTA(section, requiredTier, opts) {
    var labels = TIER_LABELS[lang][requiredTier] || TIER_LABELS[lang].pro;
    var note = (opts && opts.note) || "";
    section.innerHTML =
      '<div class="kl-paywall-cta" style="text-align:center;padding:36px 24px;margin:24px 0;background:linear-gradient(135deg,#F4F5FD 0%,#EEF2FF 100%);border:1px solid #E0E7FF;border-radius:16px;">' +
        '<span style="display:inline-block;padding:4px 12px;background:var(--teal,#00bfa5);color:#fff;border-radius:12px;font-size:12px;font-weight:700;margin-bottom:12px;">' + labels.badge + '</span>' +
        '<h3 style="margin:0 0 8px;font-size:20px;">' + labels.title + '</h3>' +
        '<p style="color:#666;margin:0 auto 20px;font-size:15px;line-height:1.6;max-width:480px;">' + labels.desc + '</p>' +
        (note ? '<p style="color:#b45309;margin:0 0 16px;font-size:13.5px;">' + note + '</p>' : '') +
        '<button class="kl-checkout-btn" data-plan="' + requiredTier + '" style="display:inline-block;padding:12px 32px;background:var(--teal,#00bfa5);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px;">' + labels.cta + '</button>' +
        '<br><a href="' + LOGIN_PATH + '" class="kl-login-link" style="color:var(--teal,#00bfa5);font-size:14px;text-decoration:none;">' + labels.login + '</a>' +
      '</div>';
  }

  // ─── Premium fetch ───
  function loadPremium(section, articleId, email, token) {
    var requiredTier = section.getAttribute("data-tier") || "pro";
    var url = API_BASE + "/api/premium?article=" + encodeURIComponent(articleId) +
              "&email=" + encodeURIComponent(email) +
              "&token=" + encodeURIComponent(token);
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          section.innerHTML = data.html;
          section.setAttribute("data-premium-loaded", "1");
          return;
        } catch (e) { /* fall through to CTA */ }
        renderCTA(section, requiredTier, { note: TIER_LABELS[lang].error });
      } else if (xhr.status === 403) {
        // Signed in, but the plan is too low for this section.
        renderCTA(section, requiredTier, { note: TIER_LABELS[lang].upgrade });
      } else if (xhr.status === 401) {
        // Token missing/stale (e.g. secret rotation) — sign in again.
        renderCTA(section, requiredTier);
      } else {
        renderCTA(section, requiredTier, { note: TIER_LABELS[lang].error });
      }
    };
    xhr.onerror = function () {
      renderCTA(section, requiredTier, { note: TIER_LABELS[lang].error });
    };
    xhr.send();
  }

  // ─── Checkout (price IDs come from /api/config at click time) ───
  function startCheckout(plan) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE + "/api/config");
    xhr.onload = function () {
      var priceId = "";
      if (xhr.status === 200) {
        try {
          var prices = (JSON.parse(xhr.responseText).prices || {});
          priceId = plan === "team" ? prices.team : prices.proMonthly;
        } catch (e) { /* ignore */ }
      }
      if (!priceId) {
        window.location.href = PRICING_PATH;
        return;
      }
      var body = { priceId: priceId };
      var email = getEmail();
      if (email) body.email = email;
      var checkout = new XMLHttpRequest();
      checkout.open("POST", API_BASE + "/api/checkout");
      checkout.setRequestHeader("Content-Type", "application/json");
      checkout.onload = function () {
        if (checkout.status === 200) {
          try {
            var data = JSON.parse(checkout.responseText);
            if (data.url) { window.location.href = data.url; return; }
          } catch (e) { /* ignore */ }
        }
        window.location.href = PRICING_PATH;
      };
      checkout.onerror = function () { window.location.href = PRICING_PATH; };
      checkout.send(JSON.stringify(body));
    };
    xhr.onerror = function () { window.location.href = PRICING_PATH; };
    xhr.send();
  }

  // ─── Main ───
  function init() {
    var sections = document.querySelectorAll("[data-premium-id]");
    if (sections.length) {
      var email = getEmail();
      var token = getToken();
      for (var i = 0; i < sections.length; i++) {
        var section = sections[i];
        var articleId = section.getAttribute("data-premium-id");
        if (email && token) {
          loadPremium(section, articleId, email, token);
        } else {
          renderCTA(section, section.getAttribute("data-tier") || "pro");
        }
      }
    }

    // Event delegation for CTA checkout buttons. Acts ONLY on buttons with
    // data-plan (our CTA cards) or data-price (legacy explicit price ID) —
    // pricing.html has its own .kl-checkout-btn handler using
    // data-price-monthly/annual, which must not double-fire here.
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".kl-checkout-btn");
      if (btn && (btn.hasAttribute("data-plan") || btn.getAttribute("data-price"))) {
        e.preventDefault();
        var explicitPrice = btn.getAttribute("data-price");
        if (explicitPrice) {
          // Legacy path: a concrete price ID was provided on the button.
          var body = { priceId: explicitPrice };
          var email = getEmail();
          if (email) body.email = email;
          var xhr = new XMLHttpRequest();
          xhr.open("POST", API_BASE + "/api/checkout");
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.onload = function () {
            if (xhr.status === 200) {
              try { var d = JSON.parse(xhr.responseText); if (d.url) window.location.href = d.url; } catch (err) { /* ignore */ }
            }
          };
          xhr.send(JSON.stringify(body));
        } else {
          startCheckout(btn.getAttribute("data-plan") || "pro");
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
