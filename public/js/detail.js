// public/js/detail.js
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

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    $('#detail-main').html(`<p>${t('detail.missingId')}</p>`);
    return;
  }

  $.get(`/api/opportunities/${id}`, function (o) {
    renderDetail(o);
  }).fail(function () {
    $('#detail-main').html(`<p>${t('detail.notFound')}</p>`);
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
        <h2>${t('detail.description')}</h2>
        <p>${(o.description || '').replace(/\n/g, '<br>')}</p>
      </section>

      ${
        o.duration
          ? `
      <section class="detail-section">
        <h2>${t('detail.duration')}</h2>
        <p>${o.duration}</p>
      </section>
      `
          : ''
      }

      ${
        o.extra
          ? `
      <section class="detail-section">
        <h2>${t('detail.profile')}</h2>
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
          ${t('detail.apply')}
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
        <h3>${t('detail.infoTitle')}</h3>
        <ul class="detail-info-list">
          ${o.type ? `<li><strong>${t('detail.typeLabel')} :</strong> ${o.type}</li>` : ''}
          ${o.country ? `<li><strong>${t('detail.countryLabel')} :</strong> ${o.country}</li>` : ''}
          ${o.city ? `<li><strong>${t('detail.cityLabel')} :</strong> ${o.city}</li>` : ''}
          ${o.funding ? `<li><strong>${t('detail.fundingLabel')} :</strong> ${o.funding}</li>` : ''}
          ${o.deadline ? `<li><strong>${t('detail.deadlineLabel')} :</strong> ${o.deadline}</li>` : ''}
          ${o.duration ? `<li><strong>${t('detail.durationLabel')} :</strong> ${o.duration}</li>` : ''}
          ${
            tagsHtml
              ? `<li><strong>${t('detail.tagsLabel')} :</strong> ${tagsHtml}</li>`
              : ''
          }
        </ul>

        ${
          o.link
            ? `<a href="${o.link}" target="_blank" class="btn-primary full-width" style="margin-top:8px;">
                 ${t('detail.applyNow')}
               </a>`
            : ''
        }

        <a href="/#opps" class="btn-secondary full-width" style="margin-top:10px;">
          ${t('detail.back')}
        </a>
      </div>
    `;

    $('#detail-sidebar').html(sidebarHtml);
  }
});
