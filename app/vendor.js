import DbInvitations from '../lib/db/invitations';

const _ = require('lodash');
const moment = require('moment');

const db = require('../lib/db');

class Vendor {
  constructor(init, dbIn, env, err) {
    this.init = init;
    this.db = dbIn;
    this.env = env;
    this.err = err;
  }

  list(offset = 0, limit = 1000) {
    return this.db.listVendors(offset, limit);
  }

  get(id) {
    return this.db.getVendor(id);
  }

  create(body, isApproved = true) {
    const params = _.clone(body);
    params.isApproved = isApproved;
    return this.db.createVendor(params)
      .catch((err) => {
        if (_.startsWith('ER_DUP_ENTRY', err.message)) {
          throw this.err.badRequest('The vendor already exists');
        }
      })
      .then(() => null);
  }

  approve(id, newId = null) {
    return this.db.getVendor(id)
      .then((data) => {
        if (!newId) {
          return this.db.updateVendor(id, { isApproved: true });
        }
        return this.db.checkVendorNotExists(newId)
          .then(() => this.db.updateVendor(id, { id: newId, isApproved: true }))
          .then(() => data.createdBy);
      });
  }

  join(user, vendor) {
    const userPool = this.init.getUserPool();
    return this.db.connect(this.env)
      .then(() => this.db.checkVendorExists(vendor))
      .then(() => this.db.end())
      .catch((err) => {
        this.db.end();
        throw err;
      })
      .then(() => userPool.addUserToVendor(user.email, vendor));
  }

  invite(vendor, email, user) {
    const emailLib = this.init.getEmail();
    const userPool = this.init.getUserPool();
    if (user.vendors.indexOf(vendor) === -1) {
      throw this.err.forbidden('You do not have access to the vendor');
    }
    return db.connect(this.env)
      .then(() => db.checkVendorExists(vendor))
      .then(() => userPool.getUser(email))
      .then((data) => {
        if (data.vendors.indexOf(vendor) !== -1) {
          throw this.err.forbidden('The user is already member of the vendor');
        }
      })
      .catch((err) => {
        if (err.code !== 'UserNotFoundException') {
          throw err;
        }
      })
      .then(() => new DbInvitations(db.getConnection(), this.err))
      .then(dbInvitations => dbInvitations.create(vendor, email, user.email))
      .then(code => emailLib.send(
        email,
        `Invitation to vendor ${vendor}`,
        'Keboola Developer Portal',
        `You have been invited to join vendor ${vendor} by ${user.name}. <a href="${this.env.API_ENDPOINT}/vendors/${vendor}/invitations/${email}/${code}">Accept the invitation</a>`
      ))
      .then(() => db.end())
      .catch((err) => {
        db.end()
          .catch(() => null);
        throw err;
      });
  }

  acceptInvitation(vendor, email, code) {
    const userPool = this.init.getUserPool();
    let dbInvitations;
    return db.connect(this.env)
      .then(() => {
        dbInvitations = new DbInvitations(db.getConnection(), this.err);
      })
      .then(() => dbInvitations.get(code))
      .then((data) => {
        if (data.acceptedOn) {
          throw this.err.badRequest('You have already accepted the invitation.');
        }
        const validLimit = moment().subtract(24, 'hours');
        if (moment(data.createdOn).isBefore(validLimit)) {
          throw this.err.badRequest('Your invitation expired. Please ask for a new one.');
        }
      })
      .then(() => userPool.addUserToVendor(email, vendor))
      .then(() => dbInvitations.accept(code))
      .then(() => db.end())
      .catch((err) => {
        db.end();
        if (err.code === 'UserNotFoundException') {
          throw this.err.notFound('User account does not exist. Please signup first.');
        }
        throw err;
      });
  }
}

export default Vendor;
