// public/js/favorites.js — member favorites page: fetch + render + live removal
$(function () {
  'use strict';

  var W = window.Wiwi;
  var t = W.t;
  var esc = W.esc;

  var $list = $('#favorites-list');
  var $count = $('#results-count');
  if (!$list.length) return;

  var items = [];

  function emptyHtml() {
    return (
      '<div class="empty-state">' +
      '<div class="empty-icon" aria-hidden="true">♥</div>' +
      '<div class="empty-title">' + esc(t('account.favoritesEmpty')) + '</div>' +
      '<a class="btn btn--accent btn--sm" href="/#opps">' + esc(t('account.favoritesBrowse')) + '</a>' +
      '</div>'
    );
  }

  function render() {
    $count.text(W.tCount('account.favoritesCount', items.length));
    if (!items.length) {
      $list.html(emptyHtml());
      return;
    }
    $list.html(
      items
        .map(function (o) {
          // A favorite can point at an expired opportunity: keep it visible, marked.
          return W.cardHtml(o, { archived: 'auto' });
        })
        .join('')
    );
  }

  // Un-hearting on this page removes the card immediately.
  $(document).on('wiwi:favchange', function (event, id, favorited) {
    if (favorited) return;
    items = items.filter(function (o) {
      return o.id !== id;
    });
    render();
  });

  W.loadMe(function (me) {
    if (!me.user) {
      window.location.href = '/login?next=%2Ffavorites';
      return;
    }
    $.get('/api/favorites')
      .done(function (res) {
        items = res && res.success && Array.isArray(res.items) ? res.items : [];
        render();
        W.syncFavButtons();
      })
      .fail(function () {
        $list.html('<p class="load-error">' + esc(t('list.loadError')) + '</p>');
      });
  });
});
