// public/js/detail.js
$(document).ready(function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    $('#detail-main').html("<p>Identifiant d’opportunité manquant.</p>");
    return;
  }

  $.get(`/api/opportunities/${id}`, function (o) {
    renderDetail(o);
  }).fail(function () {
    $('#detail-main').html('<p>Opportunité introuvable ou erreur serveur.</p>');
  });

  function renderDetail(o) {
    const mainHtml = `
      <header class="detail-header">
        <h1>${o.title}</h1>
        <div class="detail-meta">
          ${o.organization ? `<span>${o.organization}</span> · ` : ''}
          <span>${o.city || ''}${o.city ? ', ' : ''}${o.country || ''}</span>
        </div>
      </header>

      <section class="detail-description">
        <h2>Description</h2>
        <p>${(o.description || '').replace(/\n/g, '<br>')}</p>
      </section>

      ${
        o.duration
          ? `
      <section class="detail-section">
        <h2>Durée</h2>
        <p>${o.duration}</p>
      </section>
      `
          : ''
      }

      ${
        o.extra
          ? `
      <section class="detail-section">
        <h2>Profil / Conditions</h2>
        <p>${(o.extra || '').replace(/\n/g, '<br>')}</p>
      </section>
      `
          : ''
      }

      ${
        o.link
          ? `
      <section class="detail-section">
        <a href="${o.link}" target="_blank" class="btn-apply">
          Postuler à cette opportunité
        </a>
      </section>
      `
          : ''
      }
    `;

    $('#detail-main').html(mainHtml);

    const tagsHtml = (o.tags || [])
      .map((t) => `<span class="tag">${t}</span>`)
      .join('');

    const sidebarHtml = `
      <div class="detail-card">
        <h3>Infos clés</h3>
        <ul class="detail-info-list">
          ${o.type ? `<li><strong>Type :</strong> ${o.type}</li>` : ''}
          ${o.country ? `<li><strong>Pays :</strong> ${o.country}</li>` : ''}
          ${o.city ? `<li><strong>Ville :</strong> ${o.city}</li>` : ''}
          ${o.funding ? `<li><strong>Financement :</strong> ${o.funding}</li>` : ''}
          ${o.deadline ? `<li><strong>Deadline :</strong> ${o.deadline}</li>` : ''}
          ${o.duration ? `<li><strong>Durée :</strong> ${o.duration}</li>` : ''}
          ${
            tagsHtml
              ? `<li><strong>Tags :</strong> ${tagsHtml}</li>`
              : ''
          }
        </ul>

        ${
          o.link
            ? `<a href="${o.link}" target="_blank" class="btn-primary full-width" style="margin-top:8px;">
                 Postuler maintenant
               </a>`
            : ''
        }

        <a href="/#opps" class="btn-secondary full-width" style="margin-top:10px;">
          ← Retour aux opportunités
        </a>
      </div>
    `;

    $('#detail-sidebar').html(sidebarHtml);
  }
});
