// ================================================================
// MERCHY'S DESIGN STUDIO - host loader
//
//   <script src="https://YOUR-HOST/studio.js"></script>
//   MerchyStudio.open({
//     client:  { id, name, email, phone, business, projectGid, poNumber },
//     context: { mode: 'logo' | 'product', product: '6 ft x 3 ft banner', decoration: 'DTF', service, category },
//     onComplete: function(result) { /* result.selections, result.libraryIds, result.brief, result.sessionId */ },
//     onClose: function() {}
//   });
//
// Optional: window.MERCHY_API_URL = 'https://YOUR-HOST' when the script is served from another origin.
// ================================================================
(function () {
  if (window.MerchyStudio) return;

  var API = window.MERCHY_API_URL || (function () {
    var s = document.currentScript || [].slice.call(document.getElementsByTagName('script')).filter(function (x) { return /studio\.js/.test(x.src); }).pop();
    return s && s.src ? s.src.replace(/\/studio\.js.*$/, '') : '';
  })();

  var overlay = null, frame = null, opts = null, ready = false;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'merchy-studio-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,10,.6);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px)';
    var box = document.createElement('div');
    box.style.cssText = 'width:min(720px,100%);height:min(820px,100%);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);background:#fff';
    frame = document.createElement('iframe');
    frame.title = "Merchy's Design Studio";
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    frame.src = API + '/studio.html';
    box.appendChild(frame); overlay.appendChild(box); document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    if (window.innerWidth <= 560) { box.style.borderRadius = '0'; overlay.style.padding = '0'; }
  }

  function send() {
    if (!frame || !opts) return;
    frame.contentWindow.postMessage({ type: 'merchy-studio-init', client: opts.client || {}, context: opts.context || {} }, '*');
  }

  function open(o) {
    opts = o || {};
    ready = false;
    if (!overlay) build(); else overlay.style.display = 'flex';
    // The studio announces itself when loaded; we also send after load as a fallback
    frame.onload = function () { setTimeout(send, 50); };
  }

  function close() {
    if (overlay) { overlay.parentNode.removeChild(overlay); overlay = null; frame = null; }
    if (opts && typeof opts.onClose === 'function') opts.onClose();
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'merchy-studio-ready') { ready = true; send(); }
    if (d.type === 'merchy-studio-close') close();
    if (d.type === 'merchy-studio-complete' && opts && typeof opts.onComplete === 'function') opts.onComplete(d);
  });

  // Convenience: wire any element with data-merchy-studio to open the studio.
  // <button data-merchy-studio data-client='{"id":"42","business":"ACME"}' data-context='{"product":"mug"}'>
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-merchy-studio]');
    if (!el) return;
    e.preventDefault();
    var parse = function (v) { try { return v ? JSON.parse(v) : {}; } catch (err) { return {}; } };
    open({ client: parse(el.getAttribute('data-client')), context: parse(el.getAttribute('data-context')) });
  });

  window.MerchyStudio = { open: open, close: close, api: API };
})();
