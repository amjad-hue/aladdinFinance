const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DEFAULT_YEAR = 2026;

const VALID_PIPELINE_STAGES = [
  'Prospecting',
  'Qualification',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
];

const EMAIL_LOG_MAX = 50;

module.exports = { MONTHS, DEFAULT_YEAR, VALID_PIPELINE_STAGES, EMAIL_LOG_MAX };
