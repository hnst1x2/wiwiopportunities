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

  function badgeHtml(label, className) {
    if (!label) return '';
    return '<span class="badge ' + className + '">' + esc(label) + '</span>';
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
    badgeHtml: badgeHtml,
    typeBadge: typeBadge,
    fundingBadge: fundingBadge,
  };
})(window);
