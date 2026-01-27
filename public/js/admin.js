// public/js/admin.js
$(document).ready(function () {
  const data = Array.isArray(window.__ADMIN_OPPORTUNITIES__) ? window.__ADMIN_OPPORTUNITIES__ : [];
  const $tbody = $('#admin-table-body');
  const $results = $('#admin-results-count');
  const $pagination = $('#admin-pagination');

  if (!$tbody.length) return;

  const state = {
    search: '',
    country: '',
    type: '',
    funding: '',
    featured: '',
    tag: '',
    sortKey: '',
    sortDir: 'asc',
    page: 1,
    pageSize: 10,
  };

  function uniqueValues(items, key) {
    const set = new Set();
    items.forEach((o) => {
      const value = (o[key] || '').toString().trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  }

  function populateSelect($select, values) {
    values.forEach((v) => {
      $select.append(`<option value="${v}">${v}</option>`);
    });
  }

  populateSelect($('#admin-country'), uniqueValues(data, 'country'));
  populateSelect($('#admin-type'), uniqueValues(data, 'type'));
  populateSelect($('#admin-funding'), uniqueValues(data, 'funding'));

  function matchesSearch(o, term) {
    if (!term) return true;
    const hay = [
      o.title,
      o.organization,
      o.country,
      o.city,
      o.type,
      o.funding,
      o.deadline,
      o.duration,
      o.link,
      o.description,
      o.extra,
      Array.isArray(o.tags) ? o.tags.join(' ') : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(term);
  }

  function applyFilters(items) {
    const term = state.search.toLowerCase().trim();
    const tagTerm = state.tag.toLowerCase().trim();
    return items.filter((o) => {
      if (state.country && (o.country || '').toLowerCase() !== state.country.toLowerCase()) return false;
      if (state.type && (o.type || '').toLowerCase() !== state.type.toLowerCase()) return false;
      if (state.funding && (o.funding || '').toLowerCase() !== state.funding.toLowerCase()) return false;
      if (state.featured) {
        const isFeatured = !!o.featured;
        if (state.featured === 'true' && !isFeatured) return false;
        if (state.featured === 'false' && isFeatured) return false;
      }
      if (tagTerm) {
        const tags = Array.isArray(o.tags) ? o.tags.map((t) => (t || '').toLowerCase()) : [];
        if (!tags.some((t) => t.includes(tagTerm))) return false;
      }
      return matchesSearch(o, term);
    });
  }

  function compare(a, b, key) {
    const va = (a[key] || '').toString().toLowerCase();
    const vb = (b[key] || '').toString().toLowerCase();
    if (key === 'deadline') {
      return va.localeCompare(vb);
    }
    return va.localeCompare(vb, 'fr', { sensitivity: 'base' });
  }

  function applySort(items) {
    if (!state.sortKey) return items;
    const sorted = [...items].sort((a, b) => compare(a, b, state.sortKey));
    return state.sortDir === 'asc' ? sorted : sorted.reverse();
  }

  function renderRows(items) {
    $tbody.empty();
    items.forEach((o) => {
      const tags = Array.isArray(o.tags) ? o.tags.join(', ') : '';
      const row = `
        <tr>
          <td>${o.title || ''}</td>
          <td>${o.country || ''}</td>
          <td>${o.type || ''}</td>
          <td>${o.funding || ''}</td>
          <td>${o.deadline || ''}</td>
          <td>${tags}</td>
          <td>
            <div class="admin-actions-row">
              <a href="/admin/edit/${o.id}" class="btn-secondary btn-sm">Éditer</a>
              <form action="/admin/delete/${o.id}" method="post" onsubmit="return confirm('Supprimer cette opportunité ?');">
                <button type="submit" class="btn-secondary btn-sm" style="border-color:#fecaca;background:#fef2f2;color:#b91c1c;">
                  Supprimer
                </button>
              </form>
            </div>
          </td>
        </tr>
      `;
      $tbody.append(row);
    });
  }

  function renderPagination(totalItems) {
    $pagination.empty();
    const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
      const btn = $(`<button type="button">${i}</button>`);
      if (i === state.page) btn.addClass('active');
      btn.on('click', function () {
        state.page = i;
        render();
      });
      $pagination.append(btn);
    }
  }

  function render() {
    const filtered = applyFilters(data);
    const sorted = applySort(filtered);
    const start = (state.page - 1) * state.pageSize;
    const pageItems = sorted.slice(start, start + state.pageSize);

    $results.text(`${filtered.length} opportunité(s)`);
    renderRows(pageItems);
    renderPagination(filtered.length);
  }

  function resetFilters() {
    state.search = '';
    state.country = '';
    state.type = '';
    state.funding = '';
    state.featured = '';
    state.tag = '';
    state.page = 1;

    $('#admin-search').val('');
    $('#admin-country').val('');
    $('#admin-type').val('');
    $('#admin-funding').val('');
    $('#admin-featured').val('');
    $('#admin-tag').val('');
  }

  $('#admin-search').on('input', function () {
    state.search = $(this).val() || '';
    state.page = 1;
    render();
  });

  $('#admin-country').on('change', function () {
    state.country = $(this).val() || '';
    state.page = 1;
    render();
  });

  $('#admin-type').on('change', function () {
    state.type = $(this).val() || '';
    state.page = 1;
    render();
  });

  $('#admin-funding').on('change', function () {
    state.funding = $(this).val() || '';
    state.page = 1;
    render();
  });

  $('#admin-featured').on('change', function () {
    state.featured = $(this).val() || '';
    state.page = 1;
    render();
  });

  $('#admin-tag').on('input', function () {
    state.tag = $(this).val() || '';
    state.page = 1;
    render();
  });

  $('#admin-reset').on('click', function () {
    resetFilters();
    render();
  });

  $('#admin-table thead th[data-sort]').on('click', function () {
    const key = $(this).data('sort');
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = 'asc';
    }
    $('#admin-table thead th[data-sort]').removeClass('sorted-asc sorted-desc');
    $(this).addClass(state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    render();
  });

  render();
});
