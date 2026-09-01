// public/js/shared.js — helpers shared by app.js, detail.js and admin.js
(function (window) {
  'use strict';

  var I18N = window.I18N || {};
  var strings = I18N.strings || {};
  var lang = I18N.lang || 'fr';

  var URGENT_DAYS = 14;
  var DAY_MS = 86400000;

  // Stored values are French display strings (type) and normalized keys (funding).
  // Legacy spellings are accepted so older records keep rendering correctly.
  var TYPE_KEYS = {
    stage: 'stage',
    internship: 'stage',
    bourse: 'scholarship',
    scholarship: 'scholarship',
    volontariat: 'volunteering',
    volunteering: 'volunteering',
    job: 'job',
    etudes: 'studies',
    studies: 'studies',
  };

  var FUNDING_KEYS = {
    fully: 'fully',
    'fully funded': 'fully',
    'financement complet': 'fully',
    partial: 'partial',
    'partially funded': 'partial',
    'financement partiel': 'partial',
    none: 'none',
    'non finance': 'none',
    'not funded': 'none',
  };

  var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Combining diacritical marks (U+0300–U+036F): stripped after NFD normalization to ignore accents.
  var COMBINING_MARKS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

  function t(key, vars) {
    var current = strings;
    var parts = key.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (!current || typeof current !== 'object') return key;
      current = current[parts[i]];
    }
    if (typeof current !== 'string') return key;
    if (!vars) return current;
    return current.replace(/\{(\w+)\}/g, function (_, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : '{' + name + '}';
    });
  }

  function tCount(baseKey, count) {
    return t(baseKey + (count === 1 ? '.one' : '.other'), { count: count });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return HTML_ESCAPES[ch];
    });
  }

  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .trim();
  }

  function typeKey(value) {
    return TYPE_KEYS[norm(value)] || '';
  }

  function fundingKey(value) {
    return FUNDING_KEYS[norm(value)] || '';
  }

  function typeLabel(o) {
    var key = typeKey(o.type);
    return key ? t('options.types.' + key) : o.type || '';
  }

  function fundingLabel(o) {
    var key = fundingKey(o.funding);
    return key ? t('options.funding.' + key) : o.funding || '';
  }

  function countryLabel(name) {
    var map = strings.countries || {};
    return (name && map[name]) || name || '';
  }

  function placeLabel(o) {
    var country = countryLabel(o.country);
    if (!o.city) return country;
    return country ? o.city + ' · ' + country : o.city;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function todayString() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso + 'T12:00:00'));
    } catch (e) {
      return iso;
    }
  }

  // Deadline copy + urgency: "Avant le 12 oct. 2026 · J-5" (red when ≤ 14 days), "Expirée le …" once past.
  function deadlineInfo(o) {
    if (!o || !o.deadline) return null;
    var iso = String(o.deadline);
    var expired = iso < todayString();
    var days = Math.ceil((new Date(iso + 'T12:00:00').getTime() - Date.now()) / DAY_MS);
    var urgent = !expired && days <= URGENT_DAYS;
    var text = (expired ? t('card.expired') : t('card.by')) + ' ' + formatDate(iso);
    if (urgent) text += ' · ' + t('card.daysLeft', { days: Math.max(days, 0) });
    return { text: text, urgent: urgent, expired: expired, days: days };
  }

  function safeUrl(url) {
    var value = String(url || '').trim();
    return /^https?:\/\//i.test(value) ? value : '';
  }

  // Image sources may also be local uploads served from /uploads/.
  function safeImageUrl(url) {
    var value = String(url || '').trim();
    if (/^\/uploads\/[\w.-]+$/.test(value)) return value;
    return safeUrl(value);
  }

  function safeImages(o) {
    return (Array.isArray(o && o.images) ? o.images : []).map(safeImageUrl).filter(Boolean);
  }

  function badgeHtml(label, className) {
    if (!label) return '';
    return '<span class="badge ' + className + '">' + esc(label) + '</span>';
  }

  // ---- member state (login, preferences, favorites) -----------------------------
  // Loaded once per page via /api/me; hearts everywhere read from this cache.

  var me = { loaded: false, user: null, favorites: {} };

  function loadMe(callback) {
    window.jQuery
      .get('/api/me')
      .done(function (data) {
        me.user = data && data.user ? data.user : null;
        me.favorites = {};
        ((data && data.favorites) || []).forEach(function (id) {
          me.favorites[id] = true;
        });
      })
      .always(function () {
        me.loaded = true;
        syncFavButtons();
        if (callback) callback(me);
      });
  }

  function getMe() {
    return me;
  }

  function isFavorite(id) {
    return Boolean(me.favorites[id]);
  }

  function loginRedirect() {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
  }

  function toggleFavorite(id, callback) {
    if (!me.user) {
      loginRedirect();
      return;
    }
    window.jQuery
      .post('/api/favorites/' + encodeURIComponent(id))
      .done(function (res) {
        if (!res || !res.success) return;
        if (res.favorited) me.favorites[id] = true;
        else delete me.favorites[id];
        syncFavButtons();
        window.jQuery(document).trigger('wiwi:favchange', [Number(id), res.favorited]);
        if (callback) callback(res.favorited);
      })
      .fail(function (xhr) {
        if (xhr && xhr.status === 401) loginRedirect();
      });
  }

  function favButtonHtml(id) {
    var on = isFavorite(id);
    return (
      '<button type="button" class="card-fav' + (on ? ' is-on' : '') + '" data-fav-id="' + esc(id) + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(t(on ? 'account.favRemove' : 'account.favAdd')) + '">♥</button>'
    );
  }

  function syncFavButtons() {
    window.jQuery('.card-fav').each(function () {
      var $button = window.jQuery(this);
      var on = isFavorite($button.data('fav-id'));
      $button
        .toggleClass('is-on', on)
        .attr('aria-pressed', on ? 'true' : 'false')
        .attr('aria-label', t(on ? 'account.favRemove' : 'account.favAdd'));
    });
  }

  // One delegated handler for every listing heart (cards are <a> elements:
  // the click must not follow the link).
  window.jQuery(document).on('click', '.card-fav', function (event) {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(window.jQuery(this).data('fav-id'));
  });

  // ---- shared opportunity card (home, archive, favorites) ----------------------

  function cardHtml(o, opts) {
    var options = opts || {};
    var deadline = deadlineInfo(o);
    var archived = options.archived === true || (options.archived === 'auto' && deadline && deadline.expired);
    var badges = archived
      ? badgeHtml(t('archive.badge'), 'badge--expired') + typeBadge(o)
      : typeBadge(o) + fundingBadge(o);
    var deadlineHtml = deadline
      ? '<span class="card-deadline' + (deadline.urgent ? ' is-urgent' : '') + '">' + esc(deadline.text) + '</span>'
      : '';

    var images = safeImages(o);
    var mediaHtml = images.length
      ? '<div class="card-media"><img src="' + esc(images[0]) + '" alt="" loading="lazy" />' +
        (images.length > 1 ? '<span class="card-media-count">+' + (images.length - 1) + '</span>' : '') +
        '</div>'
      : '';

    return (
      '<a class="card' + (archived ? ' card--archived' : '') + (images.length ? ' card--with-media' : '') + '" href="/detail?id=' + encodeURIComponent(o.id) + '">' +
      mediaHtml +
      favButtonHtml(o.id) +
      '<div class="card-badges">' + badges + '</div>' +
      '<h3 class="card-title">' + esc(o.title) + '</h3>' +
      (o.organization ? '<div class="card-org">' + esc(o.organization) + '</div>' : '') +
      '<div class="card-footer">' +
      '<span class="place-chip">' + esc(placeLabel(o)) + '</span>' +
      deadlineHtml +
      '</div>' +
      '</a>'
    );
  }

  function typeBadge(o, extraClass) {
    var key = typeKey(o.type);
    return badgeHtml(typeLabel(o), (key ? 'badge--type-' + key : 'badge--neutral') + (extraClass || ''));
  }

  function fundingBadge(o, extraClass) {
    var key = fundingKey(o.funding);
    return badgeHtml(fundingLabel(o), (key ? 'badge--fund-' + key : 'badge--neutral') + (extraClass || ''));
  }

  window.Wiwi = {
    lang: lang,
    t: t,
    tCount: tCount,
    esc: esc,
    norm: norm,
    typeKey: typeKey,
    fundingKey: fundingKey,
    typeLabel: typeLabel,
    fundingLabel: fundingLabel,
    countryLabel: countryLabel,
    placeLabel: placeLabel,
    formatDate: formatDate,
    deadlineInfo: deadlineInfo,
    safeUrl: safeUrl,
    safeImageUrl: safeImageUrl,
    safeImages: safeImages,
    badgeHtml: badgeHtml,
    typeBadge: typeBadge,
    fundingBadge: fundingBadge,
    loadMe: loadMe,
    getMe: getMe,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    syncFavButtons: syncFavButtons,
    cardHtml: cardHtml,
  };
})(window);
