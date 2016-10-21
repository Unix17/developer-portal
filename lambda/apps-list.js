'use strict';

require('babel-polyfill');
const _ = require('lodash');
const async = require('async');
const db = require('../lib/db');
const env = require('../env.yml');
const identity = require('../lib/identity');
const request = require('../lib/request');
const vandium = require('vandium');

module.exports.appsList = vandium.createInstance({
  validation: {
    schema: {
      headers: vandium.types.object().keys({
        Authorization: vandium.types.string().required()
          .error(Error('Authorization header is required')),
      }),
      queryStringParameters: vandium.types.object().allow(null).keys({
        offset: vandium.types.number().integer().default(0).allow(''),
        limit: vandium.types.number().integer().default(100).allow(''),
      }),
    },
  },
}).handler((event, context, callback) => request.errorHandler(() => {
  db.connectEnv(env);
  async.waterfall([
    function (cb) {
      identity.getUser(env.REGION, event.headers.Authorization, cb);
    },
    function (user, cb) {
      db.listAppsForVendor(
        user.vendor,
        _.get(event, 'queryStringParameters.offset', null),
        _.get(event, 'queryStringParameters.limit', null),
        cb
      );
    },
  ], (err, res) => {
    db.end();
    return request.response(err, res, event, context, callback);
  });
}, context, callback));

module.exports.appsDetail = vandium.createInstance({
  validation: {
    schema: {
      headers: vandium.types.object().keys({
        Authorization: vandium.types.string().required()
          .error(Error('Authorization header is required')),
      }),
      pathParameters: vandium.types.object().keys({
        appId: vandium.types.string().required(),
        version: vandium.types.number().integer(),
      }),
    },
  },
}).handler((event, context, callback) => request.errorHandler(() => {
  db.connectEnv(env);
  async.waterfall([
    function (cb) {
      identity.getUser(env.REGION, event.headers.Authorization, cb);
    },
    function (user, cb) {
      db.checkAppAccess(
        event.pathParameters.appId,
        user.vendor,
        err => cb(err)
      );
    },
    function (cb) {
      db.getApp(event.pathParameters.appId, event.pathParameters.version, cb);
    },
    function (appIn, cb) {
      const app = appIn;
      app.icon = {
        32: `https://${env.CLOUDFRONT_URI}/${app.icon32}`,
        64: `https://${env.CLOUDFRONT_URI}/${app.icon64}`,
      };
      delete app.icon32;
      delete app.icon64;
      cb(null, app);
    },
  ], (err, res) => {
    db.end();
    return request.response(err, res, event, context, callback);
  });
}, context, callback));