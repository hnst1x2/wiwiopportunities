// public/js/detail.js — opportunity detail page (renders /api/opportunities/:id)
$(function () {
  'use strict';

  var W = window.Wiwi;
  var t = W.t;
  var esc = W.esc;
  var $root = $('#detail');

  if (!$root.length) return;

  var id = new URLSearchParams(window.location.search).get('id');

  function missingHtml(message) {
    return '<p class="detail-missing">' + esc(message) + '</p>';
  }

  function blockHtml(label, text) {
    return (
      '<div class="detail-block">' +
      '<div class="micro-label">' + esc(label) + '</div>' +
      '<p class="detail-text detail-text--pre">' + esc(text) + '</p>' +
      '</div>'
    );
  }

  function infoRowHtml(label, value) {
    return (
      '<div class="info-row">' +
      '<span class="info-row-label">' + esc(label) + '</span>' +
      '<span class="info-row-value">' + esc(value || '—') + '</span>' +
      '</div>'
    );
  }

  function render(o) {
    var rows = [
      infoRowHtml(t('detail.type'), W.typeLabel(o)),
      infoRowHtml(t('detail.country'), W.countryLabel(o.country)),
      infoRowHtml(t('detail.city'), o.city),
      infoRowHtml(t('detail.funding'), W.fundingLabel(o)),
      infoRowHtml(t('detail.deadline'), o.deadline ? W.formatDate(o.deadline) : ''),
      infoRowHtml(t('detail.duration'), o.duration),
    ].join('');

    var tags = (Array.isArray(o.tags) ? o.tags : [])
      .map(function (tag) {
        return '<span class="tag">' + esc(tag) + '</span>';
      })
      .join('');

    var link = W.safeUrl(o.link);
    var meta = [o.organization, W.placeLabel(o)].filter(Boolean).join(' · ');

    $root.html(
      '<article class="detail-card">' +
        '<div class="detail-badges">' + W.typeBadge(o, ' badge--lg') + W.fundingBadge(o, ' badge--lg') + '</div>' +
        '<h1 class="detail-title">' + esc(o.title) + '</h1>' +
        (meta ? '<div class="detail-meta">' + esc(meta) + '</div>' : '') +
        '<div class="detail-grid">' +
          '<div class="detail-main">' +
            (o.description ? blockHtml(t('detail.description'), o.description) : '') +
            (o.extra ? blockHtml(t('detail.profile'), o.extra) : '') +
            (tags ? '<div class="detail-tags">' + tags + '</div>' : '') +
          '</div>' +
          '<aside class="detail-aside">' +
            '<div class="info-card"><div class="micro-label">' + esc(t('detail.info')) + '</div>' + rows + '</div>' +
            (link
              ? '<a class="btn btn--gradient btn--block detail-apply" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' +
                esc(t('detail.apply')) + ' ↗</a>'
              : '') +
          '</aside>' +
        '</div>' +
      '</article>'
    );

    if (o.title) document.title = o.title + ' – WiwiOpportunity';
  }

  if (!id) {
    $root.html(missingHtml(t('detail.missingId')));
    return;
  }

  $.get('/api/opportunities/' + encodeURIComponent(id))
    .done(render)
    .fail(function () {
      $root.html(missingHtml(t('detail.notFound')));
    });
});
