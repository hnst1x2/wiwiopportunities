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

  const API_URL = '/api/opportunities';
  let allOpportunities = [];
  let filtered = [];
  let currentPage = 1;
  const pageSize = 9;

  function fetchOpportunities() {
    const status = window.__OPPS_STATUS__;
    const params = {
      search: $('#search').val() || '',
      country: $('#filter-country').val() || '',
      type: $('#filter-type').val() || '',
      funding: $('#filter-funding').val() || '',
      tag: $('#filter-tag').val() || '',
    };
    if (status) params.status = status;

    $.get(API_URL, params, function (data) {
      allOpportunities = data || [];
      currentPage = 1;
      filtered = allOpportunities;
      renderOpportunities();
      renderPagination();
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

  function renderOpportunities() {
    const $list = $('#opportunities-list');
    $list.empty();

    $('#results-count').text(tCount('home.resultsCount', filtered.length));

    if (!filtered.length) {
      $list.html(`<p>${t('home.noResults')}</p>`);
      return;
    }

    const pageItems = getPageItems();

    pageItems.forEach((o) => {
      const detailUrl = `/detail?id=${o.id}`;

      const tagsHtml = (o.tags || [])
        .map((t) => `<span class="tag">${t}</span>`)
        .join('');

      const card = `
        <article class="card">
          <div class="card-header">
            <div class="card-title">
              <a href="${detailUrl}" class="card-title-link">
                ${o.title}
              </a>
            </div>
            <div class="card-meta">
              ${o.organization ? o.organization + ' · ' : ''}${o.city || ''}${
        o.city ? ', ' : ''
      }${o.country || ''}
            </div>
          </div>
          <div class="card-description">
            ${o.description || ''}
          </div>
          <div class="card-footer">
            <div class="tags">
              <span class="tag">${o.type || t('common.opportunity')}</span>
              ${o.funding ? `<span class="tag tag-warning">${o.funding}</span>` : ''}
              ${o.deadline ? `<span class="tag tag-deadline">${t('home.deadlineLabel')}: ${o.deadline}</span>` : ''}
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
      });
      $p.append(btn);
    }
  }

  // Filtres
  $('#search, #filter-country, #filter-type, #filter-funding, #filter-tag').on('change keyup', function (e) {
    if (e.type === 'keyup' && e.key !== 'Enter') {
      // pour la recherche texte, on peut déclencher à chaque frappe
    }
    fetchOpportunities();
  });

  $('#btn-reset').on('click', function () {
    $('#search').val('');
    $('#filter-country').val('');
    $('#filter-type').val('');
    $('#filter-funding').val('');
    $('#filter-tag').val('');
    fetchOpportunities();
  });

  // Bouton de recherche du hero
  $('#btn-hero-search').on('click', function () {
    fetchOpportunities();
  });

  // Chips rapides
  $(document).on('click', '.chip', function () {
    const country = $(this).data('country');
    const type = $(this).data('type');
    const tag = $(this).data('tag');

    if (country) $('#filter-country').val(country);
    if (type) $('#filter-type').val(type);
    if (tag) $('#filter-tag').val(tag);

    fetchOpportunities();
  });

  // Newsletter submit
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
        .map((t) => `<span>${t}</span>`)
        .join('');

      const card = `
      <article class="featured-card">
        <div class="featured-badge">${t('home.featuredBadge')}</div>
        <h3><a href="${detailUrl}" class="card-title-link">${o.title}</a></h3>
        <div class="featured-meta">
          ${(o.organization || '')}${o.organization && (o.city || o.country) ? ' · ' : ''}${o.city || ''}${o.city && o.country ? ', ' : ''}${o.country || ''}
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

  // Premier chargement
  fetchOpportunities();
  $(document).ajaxComplete(function () {
    renderFeatured();
  });
});
