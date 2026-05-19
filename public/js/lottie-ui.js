/* Lottie UI — animations, transitions, loading, alert popup, counters, ripples */
const LottieUI = (() => {
  /* ── Animation loader ──────────────────────────────────────────────────────── */
  const TYPE_ANIM = { success: 'success', error: 'error', warning: 'warning', info: 'info' };

  function load(container, name, opts) {
    if (!window.lottie || !container) return null;
    if (container._lottie) { try { container._lottie.destroy(); } catch(_) {} }
    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop:     opts && opts.loop     !== undefined ? opts.loop     : false,
      autoplay: opts && opts.autoplay !== undefined ? opts.autoplay : true,
      path: '/animations/' + name + '.json'
    });
    container._lottie = anim;
    return anim;
  }

  /* ── Toast icons ───────────────────────────────────────────────────────────── */
  function playToastIcon(container, type) {
    const name = TYPE_ANIM[type];
    if (!name || !container) return;
    load(container, name, { loop: false, autoplay: true });
  }

  /* ── Confirm modal warning ─────────────────────────────────────────────────── */
  function playConfirmWarning(container) {
    if (!container) return;
    load(container, 'warning', { loop: true, autoplay: true });
  }

  /* ── Empty states ──────────────────────────────────────────────────────────── */
  function initEmptyStates(root) {
    (root || document).querySelectorAll('.es-lottie[data-anim]:not([data-anim-loaded])').forEach(el => {
      el.dataset.animLoaded = '1';
      load(el, el.dataset.anim, { loop: true, autoplay: true });
    });
  }
  const _obs = new MutationObserver(() => initEmptyStates());
  function startObserver() {
    const main = document.getElementById('main-content') || document.body;
    _obs.observe(main, { childList: true, subtree: true });
  }

  /* ── Loading overlay ───────────────────────────────────────────────────────── */
  let _loadingAnim = null;
  let _progressTimer = null;

  function showLoading(text) {
    const overlay = document.getElementById('loading-overlay');
    const lottieEl = document.getElementById('loading-lottie');
    const textEl   = document.getElementById('loading-text');
    const bar      = document.getElementById('loading-progress-bar');
    if (!overlay) return;
    if (textEl) textEl.textContent = text || 'Loading…';
    if (bar) { bar.style.width = '0%'; bar.style.transition = 'none'; }
    overlay.classList.add('active');
    if (lottieEl && !_loadingAnim) _loadingAnim = load(lottieEl, 'loading', { loop: true, autoplay: true });
    // Simulate progress
    if (bar) {
      requestAnimationFrame(() => {
        bar.style.transition = 'width 2.5s cubic-bezier(.4,0,.2,1)';
        bar.style.width = '80%';
      });
    }
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    const bar     = document.getElementById('loading-progress-bar');
    if (!overlay) return;
    if (bar) { bar.style.transition = 'width .2s ease'; bar.style.width = '100%'; }
    setTimeout(() => {
      overlay.classList.remove('active');
      if (bar) setTimeout(() => { bar.style.width = '0%'; }, 300);
    }, 200);
  }

  /* ── Alert popup ───────────────────────────────────────────────────────────── */
  let _alertCallback = null;

  function showAlert(title, body, type, onOk) {
    const el     = document.getElementById('modal-alert');
    const lEl    = document.getElementById('alert-lottie');
    const titleEl= document.getElementById('alert-title');
    const bodyEl = document.getElementById('alert-body');
    const btn    = document.getElementById('alert-ok-btn');
    if (!el) { alert(title + (body ? '\n' + body : '')); if (onOk) onOk(); return; }
    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.innerHTML    = body || '';
    const name = TYPE_ANIM[type] || 'info';
    if (lEl) load(lEl, name, { loop: name === 'warning', autoplay: true });
    const okClass = { success: 'btn btn-primary', error: 'btn btn-danger', warning: 'btn btn-danger', info: 'btn btn-primary' };
    if (btn) btn.className = (okClass[type] || 'btn btn-primary') + ' alert-ok-btn';
    _alertCallback = onOk || null;
    el.classList.add('open');
    if (name === 'success') _burstConfetti(el.querySelector('.modal'));
  }

  function closeAlert() {
    const el = document.getElementById('modal-alert');
    if (el) el.classList.remove('open');
    if (_alertCallback) { _alertCallback(); _alertCallback = null; }
  }

  /* ── Confetti burst ────────────────────────────────────────────────────────── */
  function _burstConfetti(container) {
    if (!container) return;
    const COLORS = ['#FF6600','#22C55E','#3B82F6','#F59E0B','#7C3AED','#EF4444'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.cssText = [
        'left:' + (30 + Math.random() * 40) + '%',
        'top:10%',
        'background:' + COLORS[i % COLORS.length],
        'animation-delay:' + (Math.random() * .4) + 's',
        'animation-duration:' + (.6 + Math.random() * .5) + 's',
        'transform:rotate(' + (Math.random() * 360) + 'deg)',
        'border-radius:' + (Math.random() > .5 ? '50%' : '2px'),
      ].join(';');
      container.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }
  }

  /* ── Title sparkle + underline ────────────────────────────────────────────── */
  function animateTitles(container) {
    if (!window.lottie) return;
    const c = container || document;
    c.querySelectorAll('.card-header:not([data-spark])').forEach((hdr, i) => {
      hdr.dataset.spark = '1';
      if (getComputedStyle(hdr).position === 'static') hdr.style.position = 'relative';

      // Sparkle — floats top-right of header
      const spark = document.createElement('div');
      spark.style.cssText = 'position:absolute;right:-4px;top:-14px;width:32px;height:32px;pointer-events:none;z-index:5;overflow:visible';
      hdr.appendChild(spark);
      setTimeout(() => load(spark, 'sparkle', { loop: false, autoplay: true }), i * 110);

      // Underline — sweeps across just below header
      const ul = document.createElement('div');
      ul.style.cssText = 'height:5px;overflow:visible;margin:-1px 0 1px';
      hdr.after(ul);
      setTimeout(() => load(ul, 'underline', { loop: false, autoplay: true }), i * 110 + 70);
    });
  }

  /* ── Section transition ────────────────────────────────────────────────────── */
  let _sectionExitTimer = null;

  function transitionSection(renderFn) {
    const c = document.getElementById('main-content');
    if (!c) { renderFn(); return; }
    clearTimeout(_sectionExitTimer);
    c.classList.remove('section-enter', 'anim-cards');
    c.classList.add('section-exit');
    _sectionExitTimer = setTimeout(() => {
      c.classList.remove('section-exit');
      renderFn();
      void c.offsetWidth;
      c.classList.add('section-enter', 'anim-cards');
      animateMetrics(c);
      animateTitles(c);
      setTimeout(() => c.classList.remove('anim-cards'), 700);
    }, 150);
  }

  /* ── Number counter ────────────────────────────────────────────────────────── */
  function animateMetrics(container) {
    const els = (container || document).querySelectorAll('.metric-value');
    els.forEach((el, i) => {
      const raw = el.textContent.trim();
      // Match leading $ and digits with commas
      const m = raw.match(/^\$?([\d,]+)/);
      if (!m) { _popNum(el, i); return; }
      const target = parseInt(m[1].replace(/,/g, ''), 10);
      if (!target || target < 100) { _popNum(el, i); return; }
      const prefix = raw.startsWith('$') ? '$' : '';
      const suffix = raw.slice(raw.match(/[\d,]+/)[0].length + (prefix ? 1 : 0));
      _countUp(el, target, prefix, suffix, 700 + i * 60);
    });
  }

  function _popNum(el, i) {
    setTimeout(() => {
      el.classList.remove('num-anim');
      void el.offsetWidth;
      el.classList.add('num-anim');
    }, i * 55);
  }

  function _countUp(el, target, prefix, suffix, duration) {
    const start = performance.now();
    el.classList.add('counting-shimmer');
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const cur = Math.round(target * ease);
      el.textContent = prefix + cur.toLocaleString('en-US') + suffix;
      if (t < 1) { requestAnimationFrame(frame); }
      else {
        el.textContent = prefix + target.toLocaleString('en-US') + suffix;
        el.classList.remove('counting-shimmer');
        el.classList.add('num-anim');
      }
    }
    requestAnimationFrame(frame);
  }

  /* ── Button ripple ─────────────────────────────────────────────────────────── */
  function initRipples() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const r = document.createElement('span');
      r.className = 'btn-ripple';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
      btn.style.position = btn.style.position || 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, { passive: true });
  }

  /* ── Nav icon pop ──────────────────────────────────────────────────────────── */
  function popNavIcon(section) {
    const btn = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (!btn) return;
    btn.classList.remove('nav-pop');
    void btn.offsetWidth;
    btn.classList.add('nav-pop');
    setTimeout(() => btn.classList.remove('nav-pop'), 400);
  }

  /* ── Boot ──────────────────────────────────────────────────────────────────── */
  function boot() {
    initEmptyStates();
    startObserver();
    initRipples();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return {
    load, playToastIcon, playConfirmWarning,
    initEmptyStates, startObserver,
    showLoading, hideLoading,
    showAlert, closeAlert,
    transitionSection, animateMetrics, animateTitles,
    popNavIcon,
  };
})();
