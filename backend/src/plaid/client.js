const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const plaidEnv = process.env.PLAID_ENV || 'sandbox';
console.log(`[plaid] Using environment: ${plaidEnv}`);
console.log(`[plaid] PLAID_CLIENT_ID set: ${!!process.env.PLAID_CLIENT_ID}`);
console.log(`[plaid] PLAID_SECRET set: ${!!process.env.PLAID_SECRET}`);

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

module.exports = new PlaidApi(configuration);
