// public/js/admin.js — back-office: list (search, featured toggle, delete confirm) + form validation
$(function () {
  'use strict';

  var W = window.Wiwi;
  var t = W.t;
  var esc = W.esc;

  var REQUEST_TIMEOUT_MS = 8000;

  initList();
  initForm();
  initImages();

  // ---- list -------------------------------------------------------------------

  function initList() {
    var $body = $('#admin-table-body');
    if (!$body.length) return;

    var items = Array.isArray(window.__ADMIN_OPPORTUNITIES__) ? window.__ADMIN_OPPORTUNITIES__ : [];
    var $count = $('#admin-results-count');
    var $message = $('#admin-message');

    // A record with no deadline is treated as active (mirrors the server's isActiveOpportunity).
    function isActive(o) {
      var d = W.deadlineInfo(o);
      return !d || !d.expired;
    }

    var hasActive = items.some(isActive);
    var state = {
      query: '',
      status: hasActive ? 'active' : 'all', // default to the live set; fall back to all when nothing is active
      sortKey: 'deadline',
      sortDir: 'asc',
    };

    function matchesSearch(o) {
      var needle = W.norm(state.query);
      if (!needle) return true;
      var haystack = [o.title, o.organization, o.country, W.countryLabel(o.country), o.city, (o.tags || []).join(' ')].join(' ');
      return W.norm(haystack).indexOf(needle) !== -1;
    }

    // Comparable key per sortable column. Missing deadlines sort last (ascending); featured is 1/0.
    function sortValue(o, key) {
      if (key === 'title') return W.norm(o.title);
      if (key === 'country') return W.norm(W.countryLabel(o.country));
      if (key === 'type') return W.norm(W.typeLabel(o));
      if (key === 'deadline') return o.deadline || '9999-12-31';
      if (key === 'featured') return o.featured ? 1 : 0;
      return '';
    }

    function sortRows(rows) {
      var dir = state.sortDir === 'desc' ? -1 : 1;
      return rows.slice().sort(function (a, b) {
        var va = sortValue(a, state.sortKey);
        var vb = sortValue(b, state.sortKey);
        if (va < vb) return -dir;
        if (va > vb) return dir;
        // Stable tie-break by title so equal keys keep a predictable order.
        var ta = W.norm(a.title);
        var tb = W.norm(b.title);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    }

    function rowHtml(o) {
      var deadline = W.deadlineInfo(o);
      var expired = deadline && deadline.expired;
      var deadlineClass = expired ? ' is-expired' : deadline && deadline.urgent ? ' is-urgent' : '';
      var isOn = Boolean(o.featured);

      return (
        '<div class="admin-row' + (expired ? ' admin-row--expired' : '') + '" role="row" data-id="' + esc(o.id) + '">' +
          '<div class="admin-cell-title" role="cell">' +
            '<div class="admin-opp-title">' + esc(o.title) + '</div>' +
            (o.organization ? '<div class="admin-opp-org">' + esc(o.organization) + '</div>' : '') +
          '</div>' +
          '<span class="admin-cell-country" role="cell">' + esc(W.countryLabel(o.country)) + '</span>' +
          '<span role="cell">' + W.typeBadge(o) + '</span>' +
          '<span class="admin-deadline' + deadlineClass + '" role="cell">' + esc(deadline ? deadline.text : '—') + '</span>' +
          '<span role="cell">' +
            '<button type="button" class="feat-toggle' + (isOn ? ' is-on' : '') + '" aria-pressed="' + (isOn ? 'true' : 'false') + '"' +
              ' title="' + esc(t('admin.table.featured')) + '">' + esc(isOn ? t('admin.featuredOn') : t('admin.featuredOff')) + '</button>' +
          '</span>' +
          '<div class="admin-actions" role="cell">' +
            '<a href="/admin/edit/' + esc(o.id) + '" class="btn btn--ghost btn--xs">' + esc(t('admin.edit')) + '</a>' +
            '<form action="/admin/delete/' + esc(o.id) + '" method="post" class="js-delete">' +
              '<button type="submit" class="btn btn--danger-text btn--xs">' + esc(t('admin.delete')) + '</button>' +
            '</form>' +
          '</div>' +
        '</div>'
      );
    }

    function groupHeadHtml(statusKey, count) {
      return (
        '<div class="admin-group-head" role="row">' +
          esc(t('admin.status.' + statusKey)) + ' <span class="admin-group-count">' + count + '</span>' +
        '</div>'
      );
    }

    function rowsHtml(rows) {
      return rows.map(rowHtml).join('');
    }

    function setSegCount(statusKey, count) {
      $('[data-status-count="' + statusKey + '"]').text(count);
    }

    function syncControls(shownCount) {
      $('.seg[data-status]').each(function () {
        var on = $(this).data('status') === state.status;
        $(this).toggleClass('is-active', on).attr('aria-pressed', on ? 'true' : 'false');
      });
      $('.admin-th-cell').each(function () {
        var $cell = $(this);
        var isSorted = $cell.data('col') === state.sortKey;
        $cell.attr('aria-sort', isSorted ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        $cell.find('.admin-th').removeClass('is-asc is-desc').addClass(isSorted ? 'is-' + state.sortDir : '');
      });
      $count.text(W.tCount('admin.count', shownCount));
    }

    function render() {
      var searched = items.filter(matchesSearch);
      var active = searched.filter(isActive);
      var expired = searched.filter(function (o) {
        return !isActive(o);
      });

      setSegCount('active', active.length);
      setSegCount('expired', expired.length);
      setSegCount('all', searched.length);

      var html;
      var shownCount;
      if (state.status === 'active') {
        html = rowsHtml(sortRows(active));
        shownCount = active.length;
      } else if (state.status === 'expired') {
        html = rowsHtml(sortRows(expired));
        shownCount = expired.length;
      } else {
        // "Toutes": keep the two groups visually separated, each independently sorted.
        var sortedActive = sortRows(active);
        var sortedExpired = sortRows(expired);
        html =
          (sortedActive.length ? groupHeadHtml('active', sortedActive.length) + rowsHtml(sortedActive) : '') +
          (sortedExpired.length ? groupHeadHtml('expired', sortedExpired.length) + rowsHtml(sortedExpired) : '');
        shownCount = searched.length;
      }

      if (!shownCount) html = '<div class="admin-empty-row">' + esc(t('admin.none')) + '</div>';
      $body.html(html);
      syncControls(shownCount);
    }

    function setMessage(text, isError) {
      $message.text(text).toggleClass('is-error', Boolean(isError));
    }

    // POST /admin/edit/:id rewrites the whole record from the body, so the full record is sent
    // back with only `featured` changed (unknown fields such as `domain` are preserved server-side).
    function editPayload(o, featured) {
      var payload = {
        title: o.title || '',
        organization: o.organization || '',
        country: o.country || '',
        city: o.city || '',
        type: o.type || '',
        funding: o.funding || '',
        domain: o.domain || '',
        deadline: o.deadline || '',
        duration: o.duration || '',
        link: o.link || '',
        description: o.description || '',
        extra: o.extra || '',
        tags: Array.isArray(o.tags) ? o.tags.join(', ') : o.tags || '',
        images: JSON.stringify(Array.isArray(o.images) ? o.images : []),
      };
      if (featured) payload.featured = '1';
      return payload;
    }

    function findItem(id) {
      return items.filter(function (o) {
        return o.id === id;
      })[0];
    }

    $('#admin-search').on('input', function () {
      state.query = $(this).val() || '';
      render();
    });

    // Segmented status control: separate active from expired opportunities.
    $('.admin-status-filter').on('click', '.seg[data-status]', function () {
      state.status = String($(this).data('status'));
      render();
    });

    // Sortable column headers: click to sort, click again to flip direction.
    $('.admin-row--head').on('click', '.admin-th[data-sort]', function () {
      var key = String($(this).data('sort'));
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = key === 'featured' ? 'desc' : 'asc'; // featured: show "On" first
      }
      render();
    });

    $body.on('click', '.feat-toggle', function () {
      var $button = $(this);
      var id = Number($button.closest('.admin-row').data('id'));
      var record = findItem(id);
      if (!record) return;

      var next = !record.featured;
      $button.prop('disabled', true);
      setMessage('', false);

      $.ajax({ url: '/admin/edit/' + id, method: 'POST', data: editPayload(record, next), timeout: REQUEST_TIMEOUT_MS })
        .then(function () {
          // The edit route redirects to /admin; re-read the record to verify the change was persisted.
          return $.ajax({ url: '/api/opportunities/' + id, timeout: REQUEST_TIMEOUT_MS });
        })
        .then(function (fresh) {
          if (!fresh || Boolean(fresh.featured) !== next) throw new Error('Featured flag was not persisted');
          items = items.map(function (o) {
            return o.id === id ? $.extend({}, o, { featured: next }) : o;
          });
          render();
          setMessage(t('admin.saved'), false);
        })
        .catch(function () {
          render();
          setMessage(t('admin.saveError'), true);
        });
    });

    $body.on('submit', 'form.js-delete', function (event) {
      if (!window.confirm(t('admin.confirmDelete'))) event.preventDefault();
    });

    render();
  }

  // ---- form -------------------------------------------------------------------

  function initForm() {
    var $form = $('#admin-form');
    if (!$form.length) return;

    var $error = $('#form-error');
    var REQUIRED_FIELDS = ['#title', '#country', '#type']; // mirrors the server-side rule

    $form.on('submit', function (event) {
      var missing = REQUIRED_FIELDS.filter(function (selector) {
        return !String($form.find(selector).val() || '').trim();
      });
      if (!missing.length) {
        $error.text('');
        return;
      }
      event.preventDefault();
      $error.text(t('admin.formError'));
      $form.find(missing[0]).trigger('focus');
    });
  }

  // ---- images (create/edit form) ------------------------------------------------

  function initImages() {
    var $manager = $('#images-manager');
    if (!$manager.length) return;

    var MAX_IMAGES = 10;
    var $hidden = $('#images');
    var $list = $('#image-list');
    var $urlInput = $('#image-url-input');
    var $fileInput = $('#image-upload-input');
    var $error = $('#image-error');

    var images = [];
    try {
      var parsed = JSON.parse($hidden.val() || '[]');
      if (Array.isArray(parsed)) images = parsed.map(W.safeImageUrl).filter(Boolean);
    } catch (e) {
      images = [];
    }

    function setError(message) {
      $error.text(message || '');
    }

    function render() {
      $hidden.val(JSON.stringify(images));
      $list.html(
        images
          .map(function (url, index) {
            return (
              '<div class="image-item" data-index="' + index + '">' +
                '<img class="image-thumb" src="' + esc(url) + '" alt="" loading="lazy" />' +
                (index === 0 ? '<span class="image-cover-badge">' + esc(t('admin.images.cover')) + '</span>' : '') +
                '<div class="image-item-actions">' +
                  '<button type="button" class="image-btn js-img-left" title="' + esc(t('admin.images.moveLeft')) + '"' +
                    (index === 0 ? ' disabled' : '') + '>←</button>' +
                  '<button type="button" class="image-btn js-img-right" title="' + esc(t('admin.images.moveRight')) + '"' +
                    (index === images.length - 1 ? ' disabled' : '') + '>→</button>' +
                  '<button type="button" class="image-btn image-btn--danger js-img-remove" title="' + esc(t('admin.images.remove')) + '">✕</button>' +
                '</div>' +
              '</div>'
            );
          })
          .join('')
      );
    }

    function addImage(url) {
      var safe = W.safeImageUrl(url);
      if (!safe) {
        setError(t('admin.images.invalidUrl'));
        return false;
      }
      if (images.length >= MAX_IMAGES) {
        setError(t('admin.images.limit', { max: MAX_IMAGES }));
        return false;
      }
      if (images.indexOf(safe) !== -1) return true; // already present: not an error, just no duplicate
      images = images.concat([safe]);
      setError('');
      render();
      return true;
    }

    $('#image-add-url').on('click', function () {
      if (addImage($urlInput.val())) $urlInput.val('');
    });

    // Enter in the URL field adds the image instead of submitting the whole form.
    $urlInput.on('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (addImage($urlInput.val())) $urlInput.val('');
    });

    $fileInput.on('change', function () {
      var file = this.files && this.files[0];
      $fileInput.val('');
      if (!file) return;
      if (images.length >= MAX_IMAGES) {
        setError(t('admin.images.limit', { max: MAX_IMAGES }));
        return;
      }

      var formData = new FormData();
      formData.append('image', file);
      setError(t('admin.images.uploading'));

      $.ajax({ url: '/admin/upload', method: 'POST', data: formData, processData: false, contentType: false })
        .done(function (res) {
          if (res && res.success && res.url) {
            addImage(res.url);
          } else {
            setError((res && res.error) || t('admin.images.uploadError'));
          }
        })
        .fail(function (xhr) {
          var res = xhr.responseJSON;
          setError((res && res.error) || t('admin.images.uploadError'));
        });
    });

    $list.on('click', '.js-img-remove', function () {
      var index = Number($(this).closest('.image-item').data('index'));
      images = images.filter(function (_, i) {
        return i !== index;
      });
      setError('');
      render();
    });

    function move(index, delta) {
      var target = index + delta;
      if (target < 0 || target >= images.length) return;
      var next = images.slice();
      next[index] = images[target];
      next[target] = images[index];
      images = next;
      render();
    }

    $list.on('click', '.js-img-left', function () {
      move(Number($(this).closest('.image-item').data('index')), -1);
    });

    $list.on('click', '.js-img-right', function () {
      move(Number($(this).closest('.image-item').data('index')), 1);
    });

    render();
  }
});
