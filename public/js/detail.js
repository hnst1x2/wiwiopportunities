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

  function carouselHtml(images) {
    if (!images.length) return '';
    if (images.length === 1) {
      return (
        '<div class="detail-media">' +
        '<img class="detail-media-img" src="' + esc(images[0]) + '" alt="" />' +
        '</div>'
      );
    }
    var slides = images
      .map(function (url, index) {
        return (
          '<div class="carousel-slide"' + (index === 0 ? '' : ' hidden') + ' data-index="' + index + '">' +
          '<img class="detail-media-img" src="' + esc(url) + '" alt="" loading="' + (index === 0 ? 'eager' : 'lazy') + '" />' +
          '</div>'
        );
      })
      .join('');
    var dots = images
      .map(function (_, index) {
        return (
          '<button type="button" class="carousel-dot' + (index === 0 ? ' is-active' : '') + '" data-index="' + index + '"' +
          ' aria-label="' + esc(t('detail.imageOf', { current: index + 1, total: images.length })) + '"></button>'
        );
      })
      .join('');
    return (
      '<div class="detail-media carousel" data-count="' + images.length + '">' +
        slides +
        '<button type="button" class="carousel-nav carousel-nav--prev" aria-label="' + esc(t('detail.prevImage')) + '">‹</button>' +
        '<button type="button" class="carousel-nav carousel-nav--next" aria-label="' + esc(t('detail.nextImage')) + '">›</button>' +
        '<div class="carousel-dots">' + dots + '</div>' +
      '</div>'
    );
  }

  function initCarousel() {
    var $carousel = $root.find('.carousel');
    if (!$carousel.length) return;

    var count = Number($carousel.data('count')) || 1;
    var current = 0;

    function goTo(index) {
      current = ((index % count) + count) % count;
      $carousel.find('.carousel-slide').each(function () {
        this.hidden = Number($(this).data('index')) !== current;
      });
      $carousel.find('.carousel-dot').each(function () {
        $(this).toggleClass('is-active', Number($(this).data('index')) === current);
      });
    }

    $carousel.on('click', '.carousel-nav--prev', function () {
      goTo(current - 1);
    });
    $carousel.on('click', '.carousel-nav--next', function () {
      goTo(current + 1);
    });
    $carousel.on('click', '.carousel-dot', function () {
      goTo(Number($(this).data('index')));
    });

    // Basic swipe support on touch devices.
    var touchStartX = null;
    $carousel.on('touchstart', function (event) {
      touchStartX = event.originalEvent.touches[0].clientX;
    });
    $carousel.on('touchend', function (event) {
      if (touchStartX === null) return;
      var delta = event.originalEvent.changedTouches[0].clientX - touchStartX;
      touchStartX = null;
      if (Math.abs(delta) < 40) return;
      goTo(delta > 0 ? current - 1 : current + 1);
    });
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
        carouselHtml(W.safeImages(o)) +
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
            '<button type="button" class="btn btn--ghost btn--block detail-fav" data-fav-id="' + esc(o.id) + '"></button>' +
          '</aside>' +
        '</div>' +
      '</article>'
    );

    initCarousel();
    syncFavButton(o.id);

    if (o.title) document.title = o.title + ' – Opportunities by Wiem';
  }

  // ---- favorite button (aside) ---------------------------------------------------

  function syncFavButton(oppId) {
    var on = W.isFavorite(oppId);
    $root
      .find('.detail-fav')
      .toggleClass('is-on', on)
      .attr('aria-pressed', on ? 'true' : 'false')
      .text((on ? '♥ ' : '♡ ') + t(on ? 'account.favRemove' : 'account.favAdd'));
  }

  $root.on('click', '.detail-fav', function () {
    var oppId = $(this).data('fav-id');
    W.toggleFavorite(oppId, function () {
      syncFavButton(oppId);
    });
  });

  W.loadMe(function () {
    var $fav = $root.find('.detail-fav');
    if ($fav.length) syncFavButton($fav.data('fav-id'));
  });

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
