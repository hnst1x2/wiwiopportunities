// public/js/app.js
$(document).ready(function () {
  function t(key, vars) {
    const parts = key.split('.');
    let current = window.I18N && window.I18N.strings;
    for (const part of parts) {
      if (!current || typeof current !== 'object') return key;
      current = current[part];
    }
    if (typeof current !== 'string') return key;
    if (!vars) return current;
    return current.replace(/\{(\w+)\}/g, function (_, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : `{${k}}`;
    });
  }

  function tCount(baseKey, count) {
    const key = count === 1 ? `${baseKey}.one` : `${baseKey}.other`;
    return t(key, { count });
  }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  const API_URL = '/api/opportunities';
  let allOpportunities = [];
  let filtered = [];
  let currentPage = 1;
  const pageSize = 9;
  let lastQueryKey = '';

  function syncSearchInputs(value) {
    if ($('#search').length) {
      $('#search').val(value);
    }
    if ($('#search-alt').length) {
      $('#search-alt').val(value);
    }
  }

  function getSearchValue() {
    return ($('#search').val() || $('#search-alt').val() || '').trim();
  }

  function getFiltersFromUI() {
    return {
      search: getSearchValue(),
      country: $('#filter-country').val() || '',
      type: $('#filter-type').val() || '',
      funding: $('#filter-funding').val() || '',
      tag: $('#filter-tag').val() || '',
    };
  }

  function applyFiltersToUI(filters) {
    syncSearchInputs(filters.search || '');
    if ($('#filter-country').length) $('#filter-country').val(filters.country || '');
    if ($('#filter-type').length) $('#filter-type').val(filters.type || '');
    if ($('#filter-funding').length) $('#filter-funding').val(filters.funding || '');
    if ($('#filter-tag').length) $('#filter-tag').val(filters.tag || '');
  }

  function buildQueryKey(filters) {
    return [filters.search, filters.country, filters.type, filters.funding, filters.tag].join('|');
  }

  function updateUrl(filters, page) {
    const params = new URLSearchParams();
    if (filters.search) params.set('q', filters.search);
    if (filters.country) params.set('country', filters.country);
    if (filters.type) params.set('type', filters.type);
    if (filters.funding) params.set('funding', filters.funding);
    if (filters.tag) params.set('tag', filters.tag);
    if (page && page > 1) params.set('page', String(page));
    const query = params.toString();
    const hash = window.location.hash || '';
    const nextUrl = query ? `${window.location.pathname}?${query}${hash}` : `${window.location.pathname}${hash}`;
    window.history.replaceState(null, '', nextUrl);
  }

  function readFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const page = parseInt(params.get('page'), 10);
    return {
      filters: {
        search: params.get('q') || '',
        country: params.get('country') || '',
        type: params.get('type') || '',
        funding: params.get('funding') || '',
        tag: params.get('tag') || '',
      },
      page: Number.isNaN(page) ? 1 : Math.max(page, 1),
    };
  }

  function fetchOpportunities(options) {
    const opts = options || {};
    const status = window.__OPPS_STATUS__;
    const filters = getFiltersFromUI();
    const queryKey = buildQueryKey(filters);

    if (!opts.preservePage && (opts.resetPage || queryKey !== lastQueryKey)) {
      currentPage = 1;
    }

    lastQueryKey = queryKey;
    updateUrl(filters, currentPage);

    const params = {
      search: filters.search,
      country: filters.country,
      type: filters.type,
      funding: filters.funding,
      tag: filters.tag,
    };
    if (status) params.status = status;

    $.get(API_URL, params, function (data) {
      allOpportunities = data || [];
      filtered = allOpportunities;
      renderOpportunities();
      renderPagination();
      renderActiveFilters(filters);
      renderFeatured();
    }).fail(function () {
      $('#opportunities-list').html(`<p>${t('home.loadError')}</p>`);
      $('#results-count').text(t('common.error'));
    });
  }

  function getPageItems() {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filtered.slice(start, end);
  }

  function renderActiveFilters(filters) {
    const $container = $('#active-filters');
    if (!$container.length) return;

    const chips = [];
    if (filters.search) {
      chips.push({ label: t('filters.searchLabel'), value: filters.search });
    }
    if (filters.country) {
      chips.push({ label: t('filters.country'), value: $('#filter-country option:selected').text() });
    }
    if (filters.type) {
      chips.push({ label: t('filters.type'), value: $('#filter-type option:selected').text() });
    }
    if (filters.funding) {
      chips.push({ label: t('filters.funding'), value: $('#filter-funding option:selected').text() });
    }
    if (filters.tag) {
      chips.push({ label: t('filters.domain'), value: $('#filter-tag option:selected').text() });
    }

    $container.empty();

    if (!chips.length) {
      return;
    }

    chips.forEach(function (chip) {
      const $chip = $('<span class="filter-chip"></span>');
      $chip.text(`${chip.label}: ${chip.value}`);
      $container.append($chip);
    });

    const $clear = $('<button type="button" class="filters-clear" id="btn-clear-inline"></button>');
    $clear.text(t('filters.clear'));
    $container.append($clear);
  }

  function renderOpportunities() {
    const $list = $('#opportunities-list');
    $list.empty();

    $('#results-count').text(tCount('home.resultsCount', filtered.length));

    if (!filtered.length) {
      $list.html(
        `<div class="empty-state">
          <h3>${t('home.noResultsTitle')}</h3>
          <p>${t('home.noResultsHint')}</p>
          <button type="button" class="btn-secondary btn-sm" id="btn-empty-clear">${t('filters.clear')}</button>
        </div>`
      );
      return;
    }

    const pageItems = getPageItems();

    pageItems.forEach((o) => {
      const detailUrl = `/detail?id=${o.id}`;

      const tagsHtml = (o.tags || [])
        .map((tag) => `<span class="tag">${tag}</span>`)
        .join('');

      const card = `
        <article class="card">
          <div class="card-top">
            <div class="card-badges">
              ${o.type ? `<span class="badge">${o.type}</span>` : ''}
              ${o.funding ? `<span class="badge badge-funding">${o.funding}</span>` : ''}
              ${o.deadline ? `<span class="badge badge-deadline">${t('home.deadlineLabel')}: ${o.deadline}</span>` : ''}
            </div>
          </div>
          <div class="card-header">
            <div class="card-title">
              <a href="${detailUrl}" class="card-title-link">
                ${o.title}
              </a>
            </div>
            <div class="card-meta">
              ${o.organization ? `${o.organization} &middot; ` : ''}${o.city || ''}${o.city ? ', ' : ''}${o.country || ''}
            </div>
          </div>
          <div class="card-facts">
            ${o.country ? `<span><i class="fa-solid fa-location-dot"></i>${o.country}</span>` : ''}
            ${o.type ? `<span><i class="fa-solid fa-briefcase"></i>${o.type}</span>` : ''}
            ${o.funding ? `<span><i class="fa-solid fa-circle-check"></i>${o.funding}</span>` : ''}
            ${o.deadline ? `<span><i class="fa-solid fa-calendar"></i>${t('home.deadlineLabel')}: ${o.deadline}</span>` : ''}
          </div>
          <div class="card-description">
            ${o.description || ''}
          </div>
          <div class="card-footer">
            <div class="tags">
              ${tagsHtml}
            </div>
            <div class="card-actions">
              <a href="${detailUrl}" class="btn-secondary btn-sm">${t('common.details')}</a>
              ${o.link ? `<a href="${o.link}" target="_blank" class="btn-apply">${t('common.apply')}</a>` : ''}
            </div>
          </div>
        </article>
      `;
      $list.append(card);
    });
  }

  function renderPagination() {
    const $p = $('#pagination');
    $p.empty();

    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
      const btn = $(`<button>${i}</button>`);
      if (i === currentPage) {
        btn.addClass('active');
      }
      btn.on('click', function () {
        currentPage = i;
        renderOpportunities();
        renderPagination();
        updateUrl(getFiltersFromUI(), currentPage);
      });
      $p.append(btn);
    }
  }

  function clearFilters() {
    syncSearchInputs('');
    $('#filter-country').val('');
    $('#filter-type').val('');
    $('#filter-funding').val('');
    $('#filter-tag').val('');
    fetchOpportunities({ resetPage: true });
  }

  const debouncedFetch = debounce(function () {
    fetchOpportunities({ resetPage: true });
  }, 300);

  $('#search, #search-alt').on('input', function () {
    syncSearchInputs($(this).val());
    debouncedFetch();
  });

  $('#filter-country, #filter-type, #filter-funding, #filter-tag').on('change', function () {
    fetchOpportunities({ resetPage: true });
  });

  $('#btn-reset').on('click', function () {
    clearFilters();
  });

  $(document).on('click', '#btn-clear-inline, #btn-empty-clear', function () {
    clearFilters();
  });

  $('#btn-hero-search').on('click', function () {
    syncSearchInputs($('#search').val() || '');
    fetchOpportunities({ resetPage: true });
  });

  $(document).on('click', '.chip', function () {
    const country = $(this).data('country');
    const type = $(this).data('type');
    const tag = $(this).data('tag');

    if (country) $('#filter-country').val(country);
    if (type) $('#filter-type').val(type);
    if (tag) $('#filter-tag').val(tag);

    fetchOpportunities({ resetPage: true });
  });

  $(document).on('click', '.filters-toggle', function () {
    const $panel = $(this).closest('.filters-panel');
    const isOpen = $panel.toggleClass('is-open').hasClass('is-open');
    $(this).attr('aria-expanded', isOpen ? 'true' : 'false');
  });

  $('#newsletter-form').on('submit', function (e) {
    e.preventDefault();
    const email = $('#newsletter-email').val();
    const $msg = $('#newsletter-message');

    if (!email) return;

    $.post('/newsletter', { email }, function (res) {
      if (res && res.success) {
        $msg.text(t('home.newsletterSuccess')).css('color', '#15803d');
        $('#newsletter-email').val('');
      } else {
        $msg.text(t('home.newsletterError')).css('color', '#b91c1c');
      }
    }).fail(function () {
      $msg.text(t('home.newsletterNetworkError')).css('color', '#b91c1c');
    });
  });

  function renderFeatured() {
    const $featured = $('#featured-list');
    if (!$featured.length) return;

    const featured = (allOpportunities || []).filter((o) => o.featured);
    if (!featured.length) {
      $('.featured-section').hide();
      return;
    }

    $('.featured-section').show();
    $featured.empty();

    const top = featured.slice(0, 3);

    top.forEach((o) => {
      const detailUrl = `/detail?id=${o.id}`;
      const tagsHtml = (o.tags || [])
        .map((tag) => `<span>${tag}</span>`)
        .join('');

      const card = `
      <article class="featured-card">
        <div class="featured-badge">${t('home.featuredBadge')}</div>
        <h3><a href="${detailUrl}" class="card-title-link">${o.title}</a></h3>
        <div class="featured-meta">
          ${(o.organization || '')}${o.organization && (o.city || o.country) ? ' &middot; ' : ''}${o.city || ''}${o.city && o.country ? ', ' : ''}${o.country || ''}
        </div>
        <div class="featured-tags">
          ${tagsHtml}
        </div>
        <div class="featured-actions">
          <a href="${detailUrl}" class="btn-primary btn-sm">${t('home.featuredButton')}</a>
          <div class="featured-deadline">
            ${o.deadline ? t('home.featuredUntil', { date: o.deadline }) : ''}
          </div>
        </div>
      </article>
    `;
      $featured.append(card);
    });
  }

  const initial = readFiltersFromUrl();
  applyFiltersToUI(initial.filters);
  currentPage = initial.page;
  lastQueryKey = buildQueryKey(initial.filters);
  renderActiveFilters(getFiltersFromUI());

  fetchOpportunities({ preservePage: true });
});
