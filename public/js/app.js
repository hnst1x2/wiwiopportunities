// public/js/app.js — home & archive listing: fetch + filters + URL state + pagination + newsletter
$(function () {
  'use strict';

  var W = window.Wiwi;
  var t = W.t;
  var esc = W.esc;

  var API_URL = '/api/opportunities';
  var PAGE_SIZE = 12;
  var SKELETON_COUNT = 6;
  var SEARCH_DEBOUNCE_MS = 300;
  var FEATURED_MAX = 3;
  var EMAIL_PATTERN = /.+@.+[.].+/;

  var status = window.__OPPS_STATUS__ || '';
  var isArchive = status === 'archived';

  var filteredItems = [];
  var currentPage = 1;
  var lastQueryKey = '';
  var pendingRequest = null;

  var $list = $('#opportunities-list');
  var $count = $('#results-count');
  var $pagination = $('#pagination');
  var $country = $('#filter-country');
  var $clear = $('#btn-clear');

  if (!$list.length) return;

  // ---- helpers ------------------------------------------------------------

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  function getSearchValue() {
    return ($('#search').val() || $('#search-alt').val() || '').trim();
  }

  function syncSearchInputs(value) {
    $('#search, #search-alt').val(value);
  }

  function activeChip(group) {
    var $chip = $('.chip.is-active[data-group="' + group + '"]').first();
    return $chip.length ? String($chip.data('value')) : '';
  }

  function setChip(group, value) {
    $('.chip[data-group="' + group + '"]').each(function () {
      var isActive = Boolean(value) && String($(this).data('value')) === value;
      $(this).toggleClass('is-active', isActive).attr('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function hasCountryOption(value) {
    return (
      $country.find('option').filter(function () {
        return this.value === value;
      }).length > 0
    );
  }

  function setCountry(value) {
    if (!$country.length) return;
    if (value && !hasCountryOption(value)) {
      $country.append($('<option>').val(value).text(W.countryLabel(value)));
    }
    $country.val(value || '');
  }

  function getFilters() {
    return {
      search: getSearchValue(),
      country: $country.val() || '',
      type: activeChip('type'),
      funding: activeChip('funding'),
      domain: activeChip('domain'),
    };
  }

  function hasActiveFilters(filters) {
    return Boolean(filters.search || filters.country || filters.type || filters.funding || filters.domain);
  }

  function queryKey(filters) {
    return [filters.search, filters.country, filters.type, filters.funding, filters.domain].join('|');
  }

  function scrollToList() {
    var target = document.getElementById('opps') || document.querySelector('.archive-toolbar') || $list[0];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- URL state ------------------------------------------------------------

  function updateUrl(filters, page) {
    var params = new URLSearchParams();
    if (filters.search) params.set('q', filters.search);
    if (filters.country) params.set('country', filters.country);
    if (filters.type) params.set('type', filters.type);
    if (filters.funding) params.set('funding', filters.funding);
    if (filters.domain) params.set('domain', filters.domain);
    if (page > 1) params.set('page', String(page));
    var query = params.toString();
    var hash = window.location.hash || '';
    window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + hash);
  }

  function readUrlState() {
    var params = new URLSearchParams(window.location.search);
    var page = parseInt(params.get('page'), 10);
    return {
      filters: {
        search: params.get('q') || '',
        country: params.get('country') || '',
        type: params.get('type') || '',
        funding: params.get('funding') || '',
        domain: params.get('domain') || '',
      },
      page: Number.isNaN(page) ? 1 : Math.max(page, 1),
    };
  }

  function applyFiltersToUI(filters) {
    syncSearchInputs(filters.search || '');
    setCountry(filters.country || '');
    setChip('type', filters.type || '');
    setChip('funding', filters.funding || '');
    setChip('domain', filters.domain || '');
  }

  // ---- rendering ------------------------------------------------------------

  function skeletonCardHtml() {
    return (
      '<div class="card card--skeleton" aria-hidden="true">' +
      '<span class="sk sk--badge"></span><span class="sk sk--title"></span>' +
      '<span class="sk sk--line"></span><span class="sk sk--footer"></span>' +
      '</div>'
    );
  }

  function renderSkeleton() {
    var html = '';
    for (var i = 0; i < SKELETON_COUNT; i++) html += skeletonCardHtml();
    $list.html(html);
    $pagination.empty();
    $count.text('…');
    $clear.attr('hidden', true);
  }

  function cardHtml(o) {
    return W.cardHtml(o, { archived: isArchive });
  }

  function emptyStateHtml() {
    return (
      '<div class="empty-state">' +
      '<div class="empty-icon" aria-hidden="true">✕</div>' +
      '<div class="empty-title">' + esc(t('list.emptyTitle')) + '</div>' +
      '<div class="empty-hint">' + esc(t('list.emptyHint')) + '</div>' +
      '<button type="button" class="btn btn--accent btn--sm js-clear">' + esc(t('list.clear')) + '</button>' +
      '</div>'
    );
  }

  function pageItems() {
    var start = (currentPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }

  function renderList() {
    if (!filteredItems.length) {
      $list.html(emptyStateHtml());
      return;
    }
    $list.html(pageItems().map(cardHtml).join(''));
  }

  function renderPagination() {
    var totalPages = Math.ceil(filteredItems.length / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (totalPages <= 1) {
      $pagination.empty();
      return;
    }
    var html = '';
    for (var i = 1; i <= totalPages; i++) {
      var isActive = i === currentPage;
      html +=
        '<button type="button" class="page-btn' + (isActive ? ' is-active' : '') + '" data-page="' + i + '"' +
        ' aria-label="' + esc(t('common.page', { page: i })) + '"' + (isActive ? ' aria-current="page"' : '') + '>' +
        i + '</button>';
    }
    $pagination.html(html);
  }

  function renderResultsRow(filters) {
    $count.text(W.tCount(isArchive ? 'archive.count' : 'list.count', filteredItems.length));
    if (hasActiveFilters(filters)) $clear.removeAttr('hidden');
    else $clear.attr('hidden', true);
  }

  function renderError() {
    $list.html('<p class="load-error">' + esc(t('list.loadError')) + '</p>');
    $pagination.empty();
    $count.text(t('common.error'));
  }

  // ---- featured (home only, computed from the unfiltered active set) -------------

  function featuredCardHtml(o, isDark) {
    var deadline = W.deadlineInfo(o);
    var badges = isDark
      ? W.badgeHtml(W.typeLabel(o), 'badge--lg badge--glass') + W.badgeHtml(W.fundingLabel(o), 'badge--lg badge--glass')
      : W.typeBadge(o, ' badge--lg') + W.fundingBadge(o, ' badge--lg');
    var meta = [o.organization, W.placeLabel(o)].filter(Boolean).join(' · ');

    return (
      '<a class="featured-card' + (isDark ? ' featured-card--dark' : '') + '" href="/detail?id=' + encodeURIComponent(o.id) + '">' +
      '<div class="featured-badges">' + badges + '</div>' +
      '<h3 class="featured-title">' + esc(o.title) + '</h3>' +
      (meta ? '<div class="featured-meta">' + esc(meta) + '</div>' : '') +
      (o.description ? '<p class="featured-desc">' + esc(o.description) + '</p>' : '') +
      '<div class="featured-footer">' +
      '<span class="featured-deadline">' + (deadline ? esc(deadline.text) : '') + '</span>' +
      '<span class="featured-cta">' + esc(t('featured.cta')) + ' →</span>' +
      '</div>' +
      '</a>'
    );
  }

  function renderFeatured(items) {
    var $section = $('#featured');
    if (!$section.length) return;
    var featured = items
      .filter(function (o) {
        return o.featured;
      })
      .slice(0, FEATURED_MAX);
    if (!featured.length) {
      $section.attr('hidden', true);
      return;
    }
    $('#featured-list').html(
      featured
        .map(function (o, index) {
          return featuredCardHtml(o, index === 0);
        })
        .join('')
    );
    $section.removeAttr('hidden');
  }

  // ---- custom filter chips ------------------------------------------------------
  // Types / fundings / domains are free text for the admin: values outside the
  // built-in chips get their own chip, appended after the static ones.

  function chipCanonical(group, value) {
    if (group === 'type') return W.typeKey(value) || W.norm(value);
    if (group === 'funding') return W.fundingKey(value) || W.norm(value);
    return W.norm(value);
  }

  function chipLabel(group, value) {
    if (group === 'type') return W.typeLabel({ type: value });
    if (group === 'funding') return W.fundingLabel({ funding: value });
    return value;
  }

  function appendCustomChips(items) {
    ['type', 'funding', 'domain'].forEach(function (group) {
      var $existing = $('.chip[data-group="' + group + '"]');
      if (!$existing.length) return; // this page has no filter for that group (e.g. archive)

      var known = {};
      $existing.each(function () {
        known[chipCanonical(group, String($(this).data('value')))] = true;
      });

      var $last = $existing.last();
      items.forEach(function (o) {
        var value = String(o[group] || '').trim();
        if (!value) return;
        var canonical = chipCanonical(group, value);
        if (known[canonical]) return;
        known[canonical] = true;
        var $chip = $('<button>', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: chipLabel(group, value) })
          .attr('data-group', group)
          .attr('data-value', value);
        $last.after($chip);
        $last = $chip;
      });
    });

    // A shared URL may point at a custom value whose chip didn't exist at init: re-apply it.
    var urlFilters = readUrlState().filters;
    if (urlFilters.type) setChip('type', urlFilters.type);
    if (urlFilters.funding) setChip('funding', urlFilters.funding);
    if (urlFilters.domain) setChip('domain', urlFilters.domain);
  }

  function populateCountries(items) {
    if (!$country.length) return;
    var current = $country.val() || '';
    var seen = {};
    var options = [];
    items.forEach(function (o) {
      var name = (o.country || '').trim();
      if (!name || seen[name]) return;
      seen[name] = true;
      options.push({ value: name, label: W.countryLabel(name) });
    });
    options.sort(function (a, b) {
      return a.label.localeCompare(b.label, W.lang);
    });
    $country.find('option').not(':first').remove();
    options.forEach(function (option) {
      $country.append($('<option>').val(option.value).text(option.label));
    });
    setCountry(current);
  }

  // ---- "Pour toi" (home only, logged-in members with preferences) ----------------
  // Score = how many preference groups the opportunity matches; best matches first.

  var baseItems = null; // unfiltered active set, shared with renderForYou

  function prefMatch(list, value, canon) {
    for (var i = 0; i < list.length; i++) {
      if (canon(list[i]) && canon(list[i]) === canon(value)) return true;
    }
    return false;
  }

  function forYouScore(o, prefs) {
    var score = 0;
    if (prefMatch(prefs.prefTypes, o.type, function (v) { return W.typeKey(v) || W.norm(v); })) score += 1;
    if (prefMatch(prefs.prefDomains, o.domain, W.norm)) score += 1;
    if (prefMatch(prefs.prefCountries, o.country, W.norm)) score += 1;
    return score;
  }

  function renderForYou() {
    var $section = $('#foryou');
    if (!$section.length || !baseItems) return;
    var me = W.getMe();
    if (!me.loaded || !me.user) return;

    var prefs = me.user;
    var hasPrefs = prefs.prefTypes.length || prefs.prefDomains.length || prefs.prefCountries.length;
    if (!hasPrefs) return;

    var matches = baseItems
      .map(function (o) {
        return { o: o, score: forYouScore(o, prefs) };
      })
      .filter(function (entry) {
        return entry.score > 0;
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.o.deadline || '9999') < String(b.o.deadline || '9999') ? -1 : 1;
      })
      .slice(0, FEATURED_MAX * 2);

    if (!matches.length) return;
    $('#foryou-list').html(
      matches
        .map(function (entry) {
          return cardHtml(entry.o);
        })
        .join('')
    );
    $section.removeAttr('hidden');
  }

  // ---- data -------------------------------------------------------------------

  function loadBase() {
    var params = status ? { status: status } : {};
    $.get(API_URL, params).done(function (data) {
      var items = Array.isArray(data) ? data : [];
      baseItems = items;
      populateCountries(items);
      appendCustomChips(items);
      renderFeatured(items);
      renderForYou();
    });
  }

  function fetchOpportunities(options) {
    var opts = options || {};
    var filters = getFilters();
    var key = queryKey(filters);
    if (!opts.preservePage && (opts.resetPage || key !== lastQueryKey)) currentPage = 1;
    lastQueryKey = key;
    updateUrl(filters, currentPage);
    renderSkeleton();

    var params = { search: filters.search, country: filters.country, type: filters.type, funding: filters.funding };
    if (status) params.status = status;

    if (pendingRequest) pendingRequest.abort();
    var request = $.get(API_URL, params);
    pendingRequest = request;

    request
      .done(function (data) {
        var items = Array.isArray(data) ? data : [];
        // `domain` is not an API parameter: it is applied client-side to keep the API contract unchanged.
        filteredItems = filters.domain
          ? items.filter(function (o) {
              return W.norm(o.domain) === W.norm(filters.domain);
            })
          : items;
        renderPagination();
        // renderPagination may clamp currentPage (e.g. a shared ?page=5 with only 1 page of results),
        // so re-sync the URL to the clamped value.
        updateUrl(filters, currentPage);
        renderList();
        renderResultsRow(filters);
      })
      .fail(function (xhr, textStatus) {
        if (textStatus === 'abort') return;
        renderError();
      })
      .always(function () {
        if (pendingRequest === request) pendingRequest = null;
      });
  }

  function clearFilters() {
    syncSearchInputs('');
    setCountry('');
    setChip('type', '');
    setChip('funding', '');
    setChip('domain', '');
    fetchOpportunities({ resetPage: true });
  }

  // ---- events -----------------------------------------------------------------

  var debouncedFetch = debounce(function () {
    fetchOpportunities({ resetPage: true });
  }, SEARCH_DEBOUNCE_MS);

  $('#search, #search-alt').on('input', function () {
    syncSearchInputs($(this).val());
    debouncedFetch();
  });

  $('#hero-search-form').on('submit', function (event) {
    event.preventDefault();
    syncSearchInputs($('#search').val() || '');
    fetchOpportunities({ resetPage: true });
    scrollToList();
  });

  $country.on('change', function () {
    fetchOpportunities({ resetPage: true });
  });

  $(document).on('click', '.chip[data-group]', function () {
    var $chip = $(this);
    var value = String($chip.data('value'));
    setChip($chip.data('group'), $chip.hasClass('is-active') ? '' : value);
    fetchOpportunities({ resetPage: true });
  });

  $(document).on('click', '.hero-chip', function () {
    var $chip = $(this);
    if ($chip.data('type')) setChip('type', String($chip.data('type')));
    if ($chip.data('country')) setCountry(String($chip.data('country')));
    fetchOpportunities({ resetPage: true });
    scrollToList();
  });

  $(document).on('click', '#btn-clear, .js-clear', clearFilters);

  // Already on the home page: "/#opps" and "/#newsletter" links scroll instead of reloading (keeps filters + URL state).
  $(document).on('click', 'a[href^="/#"]', function (event) {
    if (window.location.pathname !== '/') return;
    var target = document.getElementById(this.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', window.location.pathname + window.location.search + this.hash);
  });

  $pagination.on('click', '.page-btn', function () {
    currentPage = parseInt($(this).data('page'), 10) || 1;
    renderPagination();
    renderList();
    updateUrl(getFilters(), currentPage);
    scrollToList();
  });

  // ---- newsletter -------------------------------------------------------------

  function setNewsletterStatus(message, isOk) {
    $('#newsletter-message').text(message).toggleClass('is-ok', isOk).toggleClass('is-error', !isOk);
  }

  $('#newsletter-form').on('submit', function (event) {
    event.preventDefault();
    var $form = $(this);
    var $email = $('#newsletter-email');
    var email = ($email.val() || '').trim();

    if (!EMAIL_PATTERN.test(email)) {
      setNewsletterStatus(t('newsletter.invalid'), false);
      $email.trigger('focus');
      return;
    }

    var $button = $form.find('button[type="submit"]').prop('disabled', true);
    $.post('/newsletter', { email: email })
      .done(function (res) {
        if (res && res.success) {
          setNewsletterStatus(t('newsletter.success'), true);
          $email.val('');
        } else {
          setNewsletterStatus(t('newsletter.error'), false);
        }
      })
      .fail(function () {
        setNewsletterStatus(t('newsletter.networkError'), false);
      })
      .always(function () {
        $button.prop('disabled', false);
      });
  });

  // ---- init -------------------------------------------------------------------

  var initial = readUrlState();
  applyFiltersToUI(initial.filters);
  currentPage = initial.page;
  lastQueryKey = queryKey(initial.filters);
  W.loadMe(renderForYou); // hearts + "Pour toi" once the member state is known
  loadBase();
  fetchOpportunities({ preservePage: true });
});
