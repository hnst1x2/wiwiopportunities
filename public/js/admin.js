// public/js/admin.js — back-office: list (search, featured toggle, delete confirm) + form validation
$(function () {
  'use strict';

  var W = window.Wiwi;
  var t = W.t;
  var esc = W.esc;

  var REQUEST_TIMEOUT_MS = 8000;

  initList();
  initForm();

  // ---- list -------------------------------------------------------------------

  function initList() {
    var $body = $('#admin-table-body');
    if (!$body.length) return;

    var items = Array.isArray(window.__ADMIN_OPPORTUNITIES__) ? window.__ADMIN_OPPORTUNITIES__ : [];
    var query = '';
    var $count = $('#admin-results-count');
    var $message = $('#admin-message');

    function visibleItems() {
      var needle = W.norm(query);
      if (!needle) return items;
      return items.filter(function (o) {
        var haystack = [o.title, o.organization, o.country, W.countryLabel(o.country), o.city, (o.tags || []).join(' ')].join(' ');
        return W.norm(haystack).indexOf(needle) !== -1;
      });
    }

    function rowHtml(o) {
      var deadline = W.deadlineInfo(o);
      var deadlineClass = '';
      if (deadline && deadline.expired) deadlineClass = ' is-expired';
      else if (deadline && deadline.urgent) deadlineClass = ' is-urgent';
      var isOn = Boolean(o.featured);

      return (
        '<div class="admin-row" role="row" data-id="' + esc(o.id) + '">' +
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

    function render() {
      var rows = visibleItems();
      $body.html(rows.map(rowHtml).join(''));
      $count.text(W.tCount('admin.count', rows.length));
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
      query = $(this).val() || '';
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
});
