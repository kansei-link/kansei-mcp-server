/**
 * KanseiLink Paywall — client-side access gating for premium content.
 *
 * Usage in HTML:
 *   <section data-tier="pro"> ... premium content ... </section>
 *   <script src="/js/paywall.js"></script>
 *
 * Tiers: free < pro < team < enterprise
 * Sections with data-tier="pro" are visible only to pro+ subscribers.
 * Sections with data-tier="team" are visible only to team+ subscribers.
 *
 * Auth: email stored in localStorage("kl_email") after login/checkout.
 * Access checked via GET /api/access?email=...
 */
(function () {
  "use strict";

  var API_BASE = window.KANSEI_API_BASE || "https://kansei-link-mcp-production-b054.up.railway.app";
  var TIER_RANK = { free: 0, pro: 1, team: 2, enterprise: 3 };
  var STORAGE_KEY = "kl_email";
  var CACHE_KEY = "kl_access";
  var CACHE_TTL = 5 * 60 * 1000; // 5 min

  // ─── Tier labels ───
  var TIER_LABELS = {
    ja: {
      pro: { badge: "Pro", title: "Pro プランで全文を読む", desc: "Agent Voice詳細、レシピ成功率、gotchas、GPT/Claude/Gemini比較が見放題。", cta: "Pro プランに登録（$19/月）", login: "登録済みの方はこちら" },
      team: { badge: "Team", title: "Team プランで詳細レポートを見る", desc: "指定サービスの詳細レポート、競合比較、AXR推移、Agent Voice生データにアクセス。", cta: "Team プランに登録（$149/月）", login: "登録済みの方はこちら" }
    },
    en: {
      pro: { badge: "Pro", title: "Read the full article with Pro", desc: "Unlock Agent Voice details, recipe success rates, gotchas, and GPT/Claude/Gemini comparison.", cta: "Subscribe to Pro ($19/mo)", login: "Already subscribed? Sign in" },
      team: { badge: "Team", title: "Access detailed reports with Team", desc: "Per-service detailed reports, competitive analysis, AXR trends, and raw Agent Voice data.", cta: "Subscribe to Team ($149/mo)", login: "Already subscribed? Sign in" }
    }
  };

  // Detect language from <html lang="...">
  var lang = (document.documentElement.lang || "ja").startsWith("en") ? "en" : "ja";

  function getCachedAccess() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (Date.now() - cached.ts > CACHE_TTL) return null;
      return cached.data;
    } catch (e) { return null; }
  }

  function setCachedAccess(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* quota exceeded — ignore */ }
  }

  function getEmail() {
    // Check URL param first (from checkout success redirect)
    var params = new URLSearchParams(window.location.search);
    var urlEmail = params.get("email");
    if (urlEmail) {
      localStorage.setItem(STORAGE_KEY, urlEmail);
      // Clean URL
      params.delete("email");
      var clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
      window.history.replaceState({}, "", clean);
      return urlEmail;
    }
    return localStorage.getItem(STORAGE_KEY);
  }

  function checkAccess(email, cb) {
    var cached = getCachedAccess();
    if (cached && cached.email === email) {
      cb(cached);
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE + "/api/access?email=" + encodeURIComponent(email));
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          data.email = email;
          setCachedAccess(data);
          cb(data);
        } catch (e) { cb({ tier: "free", active: false }); }
      } else {
        cb({ tier: "free", active: false });
      }
    };
    xhr.onerror = function () { cb({ tier: "free", active: false }); };
    xhr.send();
  }

  function createOverlay(section, requiredTier) {
    var labels = TIER_LABELS[lang][requiredTier] || TIER_LABELS[lang].pro;
    var priceId = requiredTier === "team"
      ? (window.KANSEI_PRICE_TEAM || "")
      : (window.KANSEI_PRICE_PRO || "");

    // Blur the content
    section.style.position = "relative";
    section.style.overflow = "hidden";
    section.style.maxHeight = "400px";

    // Gradient fade
    var fade = document.createElement("div");
    fade.style.cssText = "position:absolute;bottom:0;left:0;right:0;height:200px;background:linear-gradient(transparent, var(--bg, #fff) 85%);pointer-events:none;z-index:1;";
    section.appendChild(fade);

    // CTA card
    var card = document.createElement("div");
    card.className = "kl-paywall-cta";
    card.innerHTML =
      '<div style="text-align:center;padding:32px 24px;max-width:480px;margin:0 auto;">' +
        '<span style="display:inline-block;padding:4px 12px;background:var(--teal,#00bfa5);color:#fff;border-radius:12px;font-size:12px;font-weight:700;margin-bottom:12px;">' + labels.badge + '</span>' +
        '<h3 style="margin:0 0 8px;font-size:20px;">' + labels.title + '</h3>' +
        '<p style="color:#666;margin:0 0 20px;font-size:15px;line-height:1.6;">' + labels.desc + '</p>' +
        '<button class="kl-checkout-btn" data-price="' + priceId + '" style="display:inline-block;padding:12px 32px;background:var(--teal,#00bfa5);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px;">' + labels.cta + '</button>' +
        '<br><a href="#" class="kl-login-link" style="color:var(--teal,#00bfa5);font-size:14px;text-decoration:none;">' + labels.login + '</a>' +
      '</div>';
    section.parentNode.insertBefore(card, section.nextSibling);
  }

  function showLoginPrompt(link) {
    var input = prompt(lang === "ja" ? "登録時のメールアドレスを入力してください:" : "Enter your subscription email:");
    if (input && input.indexOf("@") > 0) {
      localStorage.setItem(STORAGE_KEY, input.trim());
      localStorage.removeItem(CACHE_KEY);
      window.location.reload();
    }
  }

  function startCheckout(priceId) {
    var email = getEmail();
    var body = { priceId: priceId };
    if (email) body.email = email;

    var xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE + "/api/checkout");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.url) window.location.href = data.url;
        } catch (e) { alert("Checkout error"); }
      } else {
        alert("Checkout error: " + xhr.status);
      }
    };
    xhr.onerror = function () { alert("Network error"); };
    xhr.send(JSON.stringify(body));
  }

  // ─── Main ───
  function init() {
    var sections = document.querySelectorAll("[data-tier]");
    if (!sections.length) return;

    var email = getEmail();

    function applyAccess(access) {
      var userRank = TIER_RANK[access.tier] || 0;
      if (!access.active) userRank = 0;

      for (var i = 0; i < sections.length; i++) {
        var section = sections[i];
        var required = section.getAttribute("data-tier");
        var requiredRank = TIER_RANK[required] || 1;

        if (userRank >= requiredRank) {
          // Access granted — ensure visible
          section.style.maxHeight = "";
          section.style.overflow = "";
        } else {
          createOverlay(section, required);
        }
      }
    }

    if (email) {
      checkAccess(email, applyAccess);
    } else {
      applyAccess({ tier: "free", active: false });
    }

    // Event delegation for checkout buttons and login links
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".kl-checkout-btn");
      if (btn) {
        e.preventDefault();
        var priceId = btn.getAttribute("data-price");
        if (priceId) startCheckout(priceId);
        return;
      }
      var loginLink = e.target.closest(".kl-login-link");
      if (loginLink) {
        e.preventDefault();
        showLoginPrompt(loginLink);
      }
    });
  }

  // Run after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
