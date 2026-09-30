// Back-office pages beyond the opportunity CRUD: member management, per-member
// usage and site statistics (most viewed / most starred, connected members).
// Every route is behind the admin session guard passed in by app.js.
const express = require('express');
const usersDb = require('./usersDb');
const analytics = require('./analyticsDb');

const TOP_LIMIT = 10;
const TOP_VIEWED_DAYS = 30;
const SERIES_DAYS = 14;
const DISPLAY_TIMEZONE = process.env.DISPLAY_TIMEZONE || 'Africa/Tunis';

// SQLite stamps are 'YYYY-MM-DD HH:MM:SS' in UTC; shown in the site's local time.
function formatDateTime(value, lang, withTime = true) {
  if (!value) return '';
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  const options = withTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: DISPLAY_TIMEZONE }
    : { dateStyle: 'medium', timeZone: DISPLAY_TIMEZONE };
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', options).format(date);
}

function createAdminInsightsRouter({ requireAdmin }) {
  const router = express.Router();

  // Member emails and usage must never land in a shared or proxy cache.
  router.use('/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  function viewLocals(res, extra) {
    return {
      page: 'admin',
      baseUrl: process.env.PUBLIC_BASE_URL || '',
      fmt: (value, withTime) => formatDateTime(value, res.locals.lang, withTime),
      ...extra,
    };
  }

  function parseUserId(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).send(res.locals.t('errors.notFound'));
      return null;
    }
    return id;
  }

  // --- members -------------------------------------------------------------------

  router.get('/admin/users', requireAdmin, (req, res) => {
    res.render(
      'admin-users',
      viewLocals(res, {
        adminSection: 'users',
        title: res.locals.t('meta.adminUsersTitle'),
        users: analytics.listUsersWithUsage(),
        done: String(req.query.done || ''),
      })
    );
  });

  router.get('/admin/users/:id', requireAdmin, (req, res) => {
    const id = parseUserId(req, res);
    if (!id) return;
    const member = usersDb.getUserById(id);
    if (!member) return res.status(404).send(res.locals.t('errors.notFound'));
    res.render(
      'admin-user',
      viewLocals(res, {
        adminSection: 'users',
        title: res.locals.t('meta.adminUserTitle'),
        member,
        usage: analytics.getUserUsage(id),
        done: String(req.query.done || ''),
      })
    );
  });

  router.post('/admin/users/:id/logout', requireAdmin, (req, res) => {
    const id = parseUserId(req, res);
    if (!id) return;
    analytics.destroyUserSessions(id);
    res.redirect(`/admin/users/${id}?done=logout`);
  });

  router.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
    const id = parseUserId(req, res);
    if (!id) return;
    if (!analytics.purgeUser(id)) return res.status(404).send(res.locals.t('errors.notFound'));
    res.redirect('/admin/users?done=deleted');
  });

  // --- statistics ----------------------------------------------------------------

  router.get('/admin/stats', requireAdmin, (req, res) => {
    res.render(
      'admin-stats',
      viewLocals(res, {
        adminSection: 'stats',
        title: res.locals.t('meta.adminStatsTitle'),
        stats: analytics.connectedStats(),
        connected: analytics.listConnectedUsers(),
        topViewed: analytics.topViewed({ limit: TOP_LIMIT, sinceDays: TOP_VIEWED_DAYS }),
        topViewedDays: TOP_VIEWED_DAYS,
        topStarred: analytics.topStarred({ limit: TOP_LIMIT }),
        series: analytics.dailySeries(SERIES_DAYS),
      })
    );
  });

  return router;
}

module.exports = { createAdminInsightsRouter, formatDateTime };
