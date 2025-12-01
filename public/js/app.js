// public/js/app.js
$(document).ready(function () {
  const API_URL = '/api/opportunities';

  function fetchOpportunities() {
    const params = {
      search: $('#search').val() || '',
      country: $('#filter-country').val() || '',
      type: $('#filter-type').val() || '',
      funding: $('#filter-funding').val() || ''
    };

    $.get(API_URL, params, function (data) {
      renderOpportunities(data);
    }).fail(function () {
      $('#opportunities-list').html('<p>Erreur lors du chargement des opportunités.</p>');
      $('#results-count').text('Erreur');
    });
  }

  function renderOpportunities(opps) {
    const $list = $('#opportunities-list');
    $list.empty();

    $('#results-count').text(`${opps.length} opportunité(s) trouvée(s)`);

    if (!opps.length) {
      $list.html('<p>Aucune opportunité trouvée avec ces filtres.</p>');
      return;
    }

    opps.forEach(o => {
      const detailUrl = `/detail?id=${o.id}`;

      const card = `
        <article class="card">
          <div class="card-header">
            <div class="card-title">
              <a href="${detailUrl}" class="card-title-link">
                ${o.title}
              </a>
            </div>
            <div class="card-meta">
              ${o.organization ? o.organization + ' · ' : ''}${o.city || ''}${o.city ? ', ' : ''}${o.country || ''}
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

  // Filtres
  $('#search, #filter-country, #filter-type, #filter-funding').on('change keyup', function () {
    fetchOpportunities();
  });

  $('#btn-reset').on('click', function () {
    $('#search').val('');
    $('#filter-country').val('');
    $('#filter-type').val('');
    $('#filter-funding').val('');
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

    if (country) $('#filter-country').val(country);
    if (type) $('#filter-type').val(type);

    fetchOpportunities();
  });

  // Premier chargement
  fetchOpportunities();
});
