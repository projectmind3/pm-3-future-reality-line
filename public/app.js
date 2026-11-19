(function () {
  'use strict';

  var ALLOWED_PATHS = ['/m/new', '/m/projects', '/m/home', '/m/me'];
  var DEFAULT_PATH = '/m/home';

  function showError(message) {
    var el = document.getElementById('status');
    if (el) {
      el.textContent = message;
      el.classList.add('error');
    }
  }

  // liffId はサーバーから取得する（ページには書かない）
  function initLiff() {
    return fetch('/api/config', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('config');
        return res.json();
      })
      .then(function (config) {
        if (!config || !config.liffId) throw new Error('config');
        return liff.init({ liffId: config.liffId });
      })
      .then(function () {
        if (!liff.isLoggedIn()) {
          liff.login();
          return false;
        }
        return liff.getProfile().then(function (profile) {
          window.App.profile = profile;
          return true;
        });
      });
  }

  function start(onReady) {
    initLiff()
      .then(function (ready) {
        if (ready) return onReady();
      })
      .catch(function () {
        showError('読み込みに失敗しました。時間をおいて再度お試しください。');
      });
  }

  function pickAllowed(value) {
    if (typeof value !== 'string') return null;
    return ALLOWED_PATHS.indexOf(value) !== -1 ? value : null;
  }

  // redirect は通常の query、または liff.state（"?redirect=..." か パス）に入る
  function resolveRedirect() {
    var params = new URLSearchParams(location.search);
    var found = pickAllowed(params.get('redirect'));
    if (found) return found;

    var state = params.get('liff.state');
    if (state) {
      var q = state.charAt(0) === '?' ? state.slice(1) : state;
      found = pickAllowed(new URLSearchParams(q).get('redirect'));
      if (found) return found;
      var path = state.split(/[?#]/)[0];
      found = pickAllowed(path);
      if (found) return found;
    }
    return DEFAULT_PATH;
  }

  window.App = {
    start: start,
    resolveRedirect: resolveRedirect,
    showError: showError
  };
})();
