// public/js/app.js
$(document).ready(function () {
  const API_URL = '/api/opportunities';
  let allOpportunities = [];
  let filtered = [];
  let currentPage = 1;
  const pageSize = 9;

  function fetchOpportunities() {
    const params = {
      search: $('#search').val() || '',
      country: $('#filter-country').val() || '',
      type: $('#filter-type').val() || '',
      funding: $('#filter-funding').val() || '',
      tag: $('#filter-tag').val() || '',
    };

    $.get(API_URL, params, function (data) {
      allOpportunities = data || [];
      currentPage = 1;
      filtered = allOpportunities;
      renderOpportunities();
      renderPagination();
    }).fail(function () {
      $('#opportunities-list').html('<p>Erreur lors du chargement des opportunités.</p>');
      $('#results-count').text('Erreur');
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

    $('#results-count').text(`${filtered.length} opportunité(s) trouvée(s)`);

    if (!filtered.length) {
      $list.html('<p>Aucune opportunité trouvée avec ces filtres.</p>');
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
              <span class="tag">${o.type || 'Opportunité'}</span>
              ${o.funding ? `<span class="tag tag-warning">${o.funding}</span>` : ''}
              ${o.deadline ? `<span class="tag tag-deadline">Deadline: ${o.deadline}</span>` : ''}
              ${tagsHtml}
            </div>
            <div class="card-actions">
              <a href="${detailUrl}" class="btn-secondary btn-sm">Détails</a>
              ${o.link ? `<a href="${o.link}" target="_blank" class="btn-apply">Postuler</a>` : ''}
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
        $msg.text("Merci ! Ton email est bien enregistré ✅").css('color', '#15803d');
        $('#newsletter-email').val('');
      } else {
        $msg.text("Une erreur est survenue.").css('color', '#b91c1c');
      }
    }).fail(function () {
      $msg.text("Erreur réseau. Réessaie plus tard.").css('color', '#b91c1c');
    });
  });

  // Premier chargement
  fetchOpportunities();
  $(document).ajaxComplete(function () {
  renderFeatured();
});

});
