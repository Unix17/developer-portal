'use strict';

import Services from '../lib/Services';
import Vendor from '../app/vendor';

require('longjohn');
require('source-map-support').install();
const joi = require('joi');

const db = require('../lib/db');
const request = require('../lib/request');

const services = new Services(process.env);
const identity = Services.getIdentity();
const validation = Services.getValidation();
const vendorApp = new Vendor(services, db, process.env, Services.getError());


function createVendor(event, context, callback) {
  validation.validate(event, {
    body: {
      name: joi.string().max(64).required()
        .error(Error('Parameter vendor.name is required string with max length 64 when vendor is object')),
      address: joi.string().required()
        .error(Error('Parameter vendor.address is required string when vendor is object')),
      email: joi.string().email().required()
        .error(Error('Parameter vendor.email is required email address when vendor is object')),
    },
  });
  const body = JSON.parse(event.body);

  const vendorId = `_v${Date.now()}${Math.random()}`.substr(0, 32);
  return request.responsePromise(
    identity.getUser(event.headers.Authorization)
      .then(user =>
        db.connect(process.env)
          .then(() => vendorApp.create({
            id: vendorId,
            name: body.name,
            address: body.address,
            email: body.email,
            createdBy: user.email,
          }, false))
          .then(() => services.getUserPool().addUserToVendor(user.email, vendorId))
          .then(() => services.getNotification().approveVendor(vendorId, body.name, {
            name: body.name,
            email: body.email,
          })),
      )
      .then(() => db.end())
      .catch((err) => {
        db.end();
        throw err;
      }),
    event,
    context,
    callback,
    201
  );
}

function requestJoinVendor(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['vendor'],
  });

  return request.responsePromise(
    identity.getUser(event.headers.Authorization)
      .then((user) => {
        if (user.isAdmin) {
          return vendorApp.join(user, event.pathParameters.vendor);
        }
        return services.getNotification().approveJoinVendor({
          email: user.email,
          vendor: event.pathParameters.vendor,
        });
      }),
    event,
    context,
    callback,
    204
  );
}

function sendInvitation(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['vendor', 'email'],
  });

  return request.responsePromise(
    identity.getUser(event.headers.Authorization)
      .then(user => vendorApp.invite(
        event.pathParameters.vendor,
        event.pathParameters.email,
        user,
      )),
    event,
    context,
    callback,
    204
  );
}

function acceptInvitation(event, context, callback) {
  validation.validate(event, {
    path: ['vendor', 'email', 'code'],
  });

  return vendorApp.acceptInvitation(
    event.pathParameters.vendor,
    event.pathParameters.email,
    event.pathParameters.code,
  )
    .then(() => request.htmlResponse(null, {
      header: 'Invitation confirmed',
      content: `Your invitation to vendor ${event.pathParameters.vendor} has been successfully confirmed.`,
    }, event, context, callback))
    .catch(err => request.htmlResponse(err, null, event, context, callback));
}

function removeUser(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['vendor', 'email'],
  });

  return request.responsePromise(
    identity.getUser(event.headers.Authorization)
      .then(user => vendorApp.removeUser(
        event.pathParameters.vendor,
        event.pathParameters.email,
        user,
      )),
    event,
    context,
    callback,
    204
  );
}


module.exports.vendors = (event, context, callback) => request.errorHandler(() => {
  switch (event.resource) {
    case '/vendors':
      return createVendor(event, context, callback);
    case '/vendors/{vendor}/users':
      return requestJoinVendor(event, context, callback);
    case '/vendors/{vendor}/invitations/{email}':
      return sendInvitation(event, context, callback);
    case '/vendors/{vendor}/invitations/{email}/{code}':
      return acceptInvitation(event, context, callback);
    case '/vendors/{vendor}/users/{email}':
      return removeUser(event, context, callback);
    default:
      throw Services.getError().notFound();
  }
}, event, context, (err, res) => db.endCallback(err, res, callback));

