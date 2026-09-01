// public/js/assistant.js — floating "Wiwi" chat widget (all public pages).
// Talks to POST /api/assistant; the conversation survives page navigation via
// sessionStorage so a visitor can browse cards without losing the thread.
(function ($, Wiwi) {
  'use strict';

  if (!$ || !Wiwi) return;

  var t = Wiwi.t;
  var esc = Wiwi.esc;
  var STORAGE_KEY = 'wiwi_assistant_chat';
  var AVATAR_SRC = '/img/opportunities-by-wiem-assistant.svg';
  var MAX_MESSAGE_LENGTH = 600;
  var HISTORY_SENT = 8;

  var messages = loadMessages();
  var pending = false;

  // The assistant is members-only: the widget checks /api/me (cached by shared.js)
  // before enabling the input, and falls back to a login prompt on any 401.
  function ensureMe(callback) {
    var me = Wiwi.getMe();
    if (me.loaded) return callback(me);
    Wiwi.loadMe(callback);
  }

  function loginUrl(path) {
    return path + '?next=' + encodeURIComponent(window.location.pathname + window.location.search);
  }

  function loginPromptHtml() {
    return (
      '<div class="assistant-msg assistant-msg--bot">' +
      '<img class="assistant-avatar" src="' + AVATAR_SRC + '" alt="" width="28" height="28" />' +
      '<div class="assistant-msg-content">' +
      '<div class="assistant-bubble">' + esc(t('assistant.loginPrompt')) + '</div>' +
      '<div class="assistant-auth">' +
      '<a class="assistant-auth-btn assistant-auth-btn--primary" href="' + esc(loginUrl('/login')) + '">' + esc(t('assistant.loginBtn')) + '</a>' +
      '<a class="assistant-auth-btn" href="' + esc(loginUrl('/register')) + '">' + esc(t('assistant.registerBtn')) + '</a>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderLoginPrompt() {
    var $body = $('#assistant-messages');
    $body.html(messageHtml({ role: 'bot', text: t('assistant.greeting') }) + loginPromptHtml());
    $body.scrollTop($body[0].scrollHeight);
    setBusy(true);
  }

  function loadMessages() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveMessages() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
  }

  function suggestions() {
    var list = window.I18N && window.I18N.strings && window.I18N.strings.assistant && window.I18N.strings.assistant.suggestions;
    return Array.isArray(list) ? list : [];
  }

  // ---- rendering ---------------------------------------------------------------

  function miniCardHtml(o) {
    var deadline = Wiwi.deadlineInfo(o);
    return (
      '<a class="assistant-card" href="/detail?id=' + encodeURIComponent(o.id) + '">' +
      '<span class="assistant-card-badges">' + Wiwi.typeBadge(o) + '</span>' +
      '<span class="assistant-card-title">' + esc(o.title) + '</span>' +
      '<span class="assistant-card-meta">' +
      esc(Wiwi.placeLabel(o)) +
      (deadline ? ' · ' + esc(deadline.text) : '') +
      '</span>' +
      '</a>'
    );
  }

  function messageHtml(entry) {
    var isUser = entry.role === 'user';
    var text = esc(entry.text).replace(/\n/g, '<br>');
    var cards = (entry.opps || []).map(miniCardHtml).join('');
    return (
      '<div class="assistant-msg assistant-msg--' + (isUser ? 'user' : 'bot') + '">' +
      (isUser ? '' : '<img class="assistant-avatar" src="' + AVATAR_SRC + '" alt="" width="28" height="28" />') +
      '<div class="assistant-msg-content">' +
      '<div class="assistant-bubble">' + text + '</div>' +
      (cards ? '<div class="assistant-cards">' + cards + '</div>' : '') +
      '</div>' +
      '</div>'
    );
  }

  function renderMessages() {
    var $body = $('#assistant-messages');
    var html = messageHtml({ role: 'bot', text: t('assistant.greeting') });
    html += messages.map(messageHtml).join('');
    if (!messages.length) {
      html +=
        '<div class="assistant-suggestions">' +
        suggestions()
          .map(function (text) {
            return '<button type="button" class="assistant-chip" data-suggestion="' + esc(text) + '">' + esc(text) + '</button>';
          })
          .join('') +
        '</div>';
    }
    if (pending) {
      html +=
        '<div class="assistant-msg assistant-msg--bot">' +
        '<img class="assistant-avatar" src="' + AVATAR_SRC + '" alt="" width="28" height="28" />' +
        '<div class="assistant-msg-content"><div class="assistant-bubble assistant-bubble--typing">' + esc(t('assistant.typing')) + '</div></div>' +
        '</div>';
    }
    $body.html(html);
    $body.scrollTop($body[0].scrollHeight);
  }

  // ---- API ----------------------------------------------------------------------

  function send(text) {
    var message = String(text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message || pending) return;

    messages.push({ role: 'user', text: message });
    saveMessages();
    pending = true;
    renderMessages();
    $('#assistant-input').val('');
    setBusy(true);

    var history = messages.slice(-HISTORY_SENT - 1, -1).map(function (entry) {
      return { role: entry.role === 'user' ? 'user' : 'assistant', text: entry.text };
    });
    var authFailed = false;

    $.ajax({
      url: '/api/assistant',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ message: message, history: history }),
    })
      .done(function (res) {
        if (res && res.success && res.reply) {
          messages.push({ role: 'bot', text: res.reply, opps: res.opportunities || [] });
        } else {
          messages.push({ role: 'bot', text: t('assistant.error') });
        }
      })
      .fail(function (xhr) {
        if (xhr && xhr.status === 401) {
          // Session expirée entre-temps : on retire le message envoyé et on repasse au prompt de connexion.
          authFailed = true;
          messages.pop();
          return;
        }
        var serverError = xhr && xhr.responseJSON && xhr.responseJSON.error;
        messages.push({ role: 'bot', text: serverError || t('assistant.error') });
      })
      .always(function () {
        pending = false;
        saveMessages();
        if (authFailed) {
          renderLoginPrompt();
          return;
        }
        setBusy(false);
        renderMessages();
        $('#assistant-input').trigger('focus');
      });
  }

  function setBusy(busy) {
    $('#assistant-input, #assistant-send').prop('disabled', busy);
  }

  // ---- widget shell ---------------------------------------------------------------

  function widgetHtml() {
    return (
      '<div class="assistant-root">' +
      '<div class="assistant-panel" id="assistant-panel" role="dialog" aria-label="' + esc(t('assistant.title')) + '" hidden>' +
      '<div class="assistant-head">' +
      '<span class="assistant-head-title">' +
      '<img class="assistant-head-avatar" src="' + AVATAR_SRC + '" alt="" width="34" height="34" />' +
      esc(t('assistant.title')) +
      '</span>' +
      '<span class="assistant-head-actions">' +
      '<button type="button" class="assistant-icon-btn" id="assistant-clear" title="' + esc(t('assistant.clear')) + '" aria-label="' + esc(t('assistant.clear')) + '">↺</button>' +
      '<button type="button" class="assistant-icon-btn" id="assistant-close" aria-label="' + esc(t('assistant.close')) + '">✕</button>' +
      '</span>' +
      '</div>' +
      '<div class="assistant-messages" id="assistant-messages" aria-live="polite"></div>' +
      '<form class="assistant-form" id="assistant-form">' +
      '<input type="text" id="assistant-input" maxlength="' + MAX_MESSAGE_LENGTH + '" placeholder="' + esc(t('assistant.placeholder')) + '" autocomplete="off" />' +
      '<button type="submit" class="assistant-send" id="assistant-send" aria-label="' + esc(t('assistant.send')) + '">➤</button>' +
      '</form>' +
      '<a class="assistant-insta" href="' + esc(window.WIWI_INSTAGRAM || 'https://www.instagram.com/opportunities.by.wiem/') + '" target="_blank" rel="noopener">' +
      esc(t('assistant.instaFooter')) + ' <strong>@opportunities.by.wiem</strong>' +
      '</a>' +
      '</div>' +
      '<button type="button" class="assistant-fab" id="assistant-fab" aria-expanded="false" aria-label="' + esc(t('assistant.open')) + '">' +
      '<img class="assistant-fab-icon" src="' + AVATAR_SRC + '" alt="" width="56" height="56" />' +
      '</button>' +
      '</div>'
    );
  }

  function togglePanel(open) {
    var $panel = $('#assistant-panel');
    var show = typeof open === 'boolean' ? open : $panel.prop('hidden');
    $panel.prop('hidden', !show);
    $('body').toggleClass('assistant-open', show);
    $('#assistant-fab')
      .attr('aria-expanded', show ? 'true' : 'false')
      .attr('aria-label', t(show ? 'assistant.close' : 'assistant.open'))
      .toggleClass('is-open', show);
    if (show) {
      renderMessages();
      ensureMe(function (me) {
        if (!me.user) {
          renderLoginPrompt();
        } else {
          setBusy(false);
          $('#assistant-input').trigger('focus');
        }
      });
    }
  }

  $(function () {
    $('body').append(widgetHtml());

    $('#assistant-fab').on('click', function () {
      togglePanel();
    });
    $('#assistant-close').on('click', function () {
      togglePanel(false);
    });
    $('#assistant-clear').on('click', function () {
      messages = [];
      saveMessages();
      renderMessages();
    });
    $('#assistant-form').on('submit', function (event) {
      event.preventDefault();
      send($('#assistant-input').val());
    });
    $(document).on('click', '.assistant-chip', function () {
      send($(this).data('suggestion'));
    });
    $(document).on('keydown', function (event) {
      if (event.key === 'Escape' && !$('#assistant-panel').prop('hidden')) togglePanel(false);
    });
  });
})(window.jQuery, window.Wiwi);
