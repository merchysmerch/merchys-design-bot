// ================================================================
// MERCHY'S AI DESIGN BOT — Embeddable Widget Loader
// Usage: <script src="https://your-domain.com/widget.js"></script>
// Optional: window.MERCHY_API_URL = 'https://your-api.com';
// ================================================================
(function() {
  if (document.getElementById('merchys-widget-root')) return;

  var API = window.MERCHY_API_URL || (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) {
        return scripts[i].src.replace(/\/widget\.js.*$/, '');
      }
    }
    return '';
  })();

  // Load Poppins font
  var fontLink = document.createElement('link');
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap';
  fontLink.rel = 'stylesheet';
  document.head.appendChild(fontLink);

  // Floating button
  var btn = document.createElement('div');
  btn.id = 'merchys-widget-btn';
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg><span>Design Studio</span>';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;align-items:center;gap:8px;padding:14px 22px;background:#111;color:#d4a017;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;border:2px solid #d4a017;border-radius:50px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);transition:all 0.3s ease;';
  btn.onmouseover = function() { this.style.background = '#d4a017'; this.style.color = '#111'; };
  btn.onmouseout = function() { this.style.background = '#111'; this.style.color = '#d4a017'; };

  // Widget panel
  var panel = document.createElement('div');
  panel.id = 'merchys-widget-root';
  panel.style.cssText = 'position:fixed;bottom:90px;right:24px;width:400px;height:580px;z-index:99999;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.25);display:none;font-family:Poppins,sans-serif;';

  var iframe = document.createElement('iframe');
  iframe.src = API + '/widget.html';
  iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:16px;';
  iframe.allow = 'payment';
  panel.appendChild(iframe);

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var open = false;
  btn.onclick = function() {
    open = !open;
    panel.style.display = open ? 'block' : 'none';
    btn.querySelector('span').textContent = open ? 'Close' : 'Design Studio';
  };

  // Mobile: full screen
  function checkMobile() {
    if (window.innerWidth <= 520) {
      panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:99999;border-radius:0;overflow:hidden;box-shadow:none;display:' + (open ? 'block' : 'none') + ';font-family:Poppins,sans-serif;';
      iframe.style.borderRadius = '0';
    } else {
      panel.style.cssText = 'position:fixed;bottom:90px;right:24px;width:400px;height:580px;z-index:99999;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.25);display:' + (open ? 'block' : 'none') + ';font-family:Poppins,sans-serif;';
      iframe.style.borderRadius = '16px';
    }
  }
  window.addEventListener('resize', checkMobile);

  // Listen for close messages from iframe
  window.addEventListener('message', function(e) {
    if (e.data === 'merchys-close') { open = false; panel.style.display = 'none'; btn.querySelector('span').textContent = 'Design Studio'; }
  });
})();
