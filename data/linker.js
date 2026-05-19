const { load } = require('./store');
const { seed } = require('./seed');

function loadAll() {
  return {
    clients:     load('clients.json',     seed().clients),
    ar:          load('ar.json',          seed().accountReceivables),
    pipeline:    load('pipeline.json',    seed().pipeline),
    commissions: load('commissions.json', []),
  };
}

// lowercase name → client (active only)
function buildClientMap(clients) {
  const map = new Map();
  clients.filter(c => !c.archived).forEach(c => map.set(c.name.toLowerCase().trim(), c));
  return map;
}

function resolveClientId(name, clientMap) {
  if (!name) return null;
  return clientMap.get(name.toLowerCase().trim())?.id ?? null;
}

function resolveDealId(dealName, pipeline) {
  if (!dealName) return null;
  return pipeline.find(p => p.name?.toLowerCase().trim() === dealName.toLowerCase().trim())?.id ?? null;
}

// Enrich AR item — add clientId if absent, default revenueType to 'Services'
function enrichARItem(item, clientMap) {
  return {
    ...item,
    clientId:    item.clientId    ?? resolveClientId(item.client, clientMap),
    revenueType: item.revenueType || 'Services',
  };
}

// Enrich pipeline deal — add clientId if absent
function enrichDealItem(deal, clientMap) {
  return {
    ...deal,
    clientId: deal.clientId ?? resolveClientId(deal.client, clientMap),
  };
}

// Enrich commission — add clientId + dealId if absent
function enrichCommissionItem(item, clientMap, pipeline) {
  return {
    ...item,
    clientId: item.clientId ?? resolveClientId(item.client, clientMap),
    dealId:   item.dealId   ?? resolveDealId(item.dealName, pipeline),
  };
}

const SAAS_TYPES = ['Enterprise', 'SaaS'];

// Full computation — enriches all records in-memory, builds per-client aggregates and validation stats.
// Does NOT persist anything to disk.
function computeLinked() {
  const { clients, ar, pipeline, commissions } = loadAll();
  const clientMap = buildClientMap(clients);

  const enrichedAR          = ar.map(x => enrichARItem(x, clientMap));
  const enrichedPipeline    = pipeline.map(d => enrichDealItem(d, clientMap));
  const enrichedCommissions = commissions.map(c => enrichCommissionItem(c, clientMap, pipeline));

  // Per-client aggregates
  const byClient = {};
  clients.filter(c => !c.archived).forEach(c => {
    byClient[c.id] = { client: c, invoices: [], deals: [], commissions: [], arTotal: 0, arPaid: 0, pipelineWtd: 0 };
  });

  enrichedAR.forEach(x => {
    const bucket = x.clientId ? byClient[x.clientId] : null;
    if (bucket) {
      bucket.invoices.push(x);
      bucket.arTotal += x.amount || 0;
      if (x.status === 'paid') bucket.arPaid += x.amount || 0;
    }
  });

  enrichedPipeline.forEach(d => {
    const bucket = d.clientId ? byClient[d.clientId] : null;
    if (bucket) {
      bucket.deals.push(d);
      if (d.stage !== 'Closed Lost') bucket.pipelineWtd += (d.value || 0) * ((d.probability || 0) / 100);
    }
  });

  enrichedCommissions.forEach(c => {
    const bucket = c.clientId ? byClient[c.clientId] : null;
    if (bucket) bucket.commissions.push(c);
  });

  // Revenue metrics from enriched AR
  const paidAR      = enrichedAR.filter(x => x.status === 'paid');
  const saasRevenue = paidAR.filter(x => SAAS_TYPES.includes(x.revenueType)).reduce((s, x) => s + (x.amount || 0), 0);
  const svcRevenue  = paidAR.filter(x => !SAAS_TYPES.includes(x.revenueType)).reduce((s, x) => s + (x.amount || 0), 0);
  const totalRevenue = saasRevenue + svcRevenue;

  // Closed Won deals without any AR invoice for that client
  const arClientIds  = new Set(enrichedAR.map(x => x.clientId).filter(Boolean));
  const closedWon    = enrichedPipeline.filter(d => d.stage === 'Closed Won');
  const wonWithoutAR = closedWon.filter(d => d.clientId && !arClientIds.has(d.clientId));

  return {
    clients,
    ar:          enrichedAR,
    pipeline:    enrichedPipeline,
    commissions: enrichedCommissions,
    byClient,
    saasRevenue, svcRevenue, totalRevenue,
    closedWon, wonWithoutAR,
    stats: {
      arMissingClientId:    enrichedAR.filter(x => !x.clientId).length,
      arMissingRevenueType: ar.filter(x => !x.revenueType || x.revenueType === '').length,
      dealsMissingClientId: enrichedPipeline.filter(d => !d.clientId).length,
      commMissingDealId:    enrichedCommissions.filter(c => !c.dealId && c.dealName).length,
      commMissingClientId:  enrichedCommissions.filter(c => !c.clientId).length,
      wonWithoutAR:         wonWithoutAR.length,
    },
  };
}

module.exports = {
  loadAll, buildClientMap, resolveClientId, resolveDealId,
  enrichARItem, enrichDealItem, enrichCommissionItem, computeLinked,
};
