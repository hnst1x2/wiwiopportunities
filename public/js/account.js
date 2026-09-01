// public/js/account.js — account page: confirmation guard on account deletion
$(function () {
  'use strict';

  var t = window.Wiwi.t;

  $('#delete-account-form').on('submit', function (event) {
    if (!window.confirm(t('account.deleteConfirm'))) event.preventDefault();
  });
});
