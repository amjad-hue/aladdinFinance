const router = require('express').Router();
const { load, save }       = require('../data/store');
const { seed }             = require('../data/seed');
const { requireRole }      = require('../middleware/roles');
const mailer               = require('../lib/mailer');
const { MONTHS, EMAIL_LOG_MAX } = require('../lib/constants');
const { dubaiNow, dubaiDateStr } = require('../lib/scheduler');

// â”€â”€ Email send log helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _appendEmailLog(type, to, status, message) {
  try {
    const cfg = load('app-settings.json', {});
    const log = cfg.emailSendLog || [];
    log.unshift({ ts: new Date().toISOString(), type, to, status, message });
    if (log.length > EMAIL_LOG_MAX) log.length = EMAIL_LOG_MAX;
    save('app-settings.json', { ...cfg, emailSendLog: log });
  } catch(_) {}
}

router.get('/email-log', (req, res) => {
  const cfg = load('app-settings.json', {});
  res.json(cfg.emailSendLog || []);
});

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const fmt  = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v||0);
const fmtK = v => (v<0?'-':'')+'$'+Math.round(Math.abs(v||0)/1000)+'k';
const MO   = MONTHS;

function getData() {
  const TODAY = dubaiNow();
  const banks       = load('cash.json',       seed().banks);
  const reserves    = load('reserves.json',   seed().reserves);
  const cashflow    = load('cashflow.json',   seed().cashflow);
  const revenue     = load('revenue.json',    seed().revenue);
  const budget      = load('budget.json',     seed().budget);
  const clients     = load('clients.json',    seed().clients);
  const pipeline    = load('pipeline.json',   seed().pipeline);
  const tasks       = load('tasks.json',      seed().tasks);
  const liabilities = load('liabilities.json',seed().liabilities);
  const ar          = load('ar.json',          seed().accountReceivables);

  const totalCash  = banks.reduce((s,b)=>s+b.total,0);
  const reserved   = reserves.reduce((s,r)=>s+r.amount,0);
  const available  = totalCash - reserved;
  const ytdRev     = revenue.filter(r=>r.revenue>0).reduce((s,r)=>s+r.revenue,0);
  const ytdTgt     = revenue.filter(r=>r.revenue>0).reduce((s,r)=>s+r.target,0);
  const ytdExp     = revenue.filter(r=>r.revenue>0).reduce((s,r)=>s+r.expenses,0);
  const totalLiab  = liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
  const totalAR    = ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+x.amount,0);
  const overdueAR  = ar.filter(x=>x.status==='overdue').reduce((s,x)=>s+x.amount,0);
  const pipeWtd    = pipeline.reduce((s,d)=>s+d.value*(d.probability/100),0);
  const margin     = ytdRev ? Math.round(((ytdRev-ytdExp)/ytdRev)*100) : 0;
  const currentRatio = totalLiab ? ((available+totalAR)/totalLiab).toFixed(2) : '—';
  const quickRatio   = totalLiab ? (available/totalLiab).toFixed(2) : '—';
  const dso = ytdRev ? Math.round((totalAR/(ytdRev/6))*30) : 0;

  return { TODAY, banks, reserves, cashflow, revenue, budget, clients, pipeline, tasks,
           liabilities, ar, totalCash, reserved, available, ytdRev, ytdTgt, ytdExp,
           totalLiab, totalAR, overdueAR, pipeWtd, margin, currentRatio, quickRatio, dso };
}

// â”€â”€ Email HTML template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildEmailHTML(d, baseUrl, opts={}) {
  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});
  const introText = opts.intro || '';

  // Liabilities: top 4 + other
  const liabCats = d.liabilities.map(c=>({...c,total:(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0)})).sort((a,b)=>b.total-a.total);
  const top4Liab  = liabCats.slice(0,4);
  const otherLiab = liabCats.slice(4).reduce((s,c)=>s+c.total,0);

  const arRows = d.ar.filter(x=>x.status!=='paid').sort((a,b)=>b.amount-a.amount).slice(0,6);

  const statusColor = s => ({pending:'#2563EB',overdue:'#DC2626',paid:'#16A34A'}[s]||'#5E6C84');
  const statusBg    = s => ({pending:'#EFF6FF',overdue:'#FEF2F2',paid:'#F0FDF4'}[s]||'#F4F6FA');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CFO Genie Financial Summary</title>
</head>
<body style="margin:0;padding:0;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#24292E">

<!-- Wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF0F5;padding:30px 0">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);border-radius:14px 14px 0 0;padding:32px 36px">
    <table width="100%"><tr>
      <td>
        <div style="display:inline-block;width:46px;height:46px;background:rgba(255,255,255,0.25);border-radius:12px;text-align:center;line-height:46px;font-weight:800;font-size:20px;color:#fff;vertical-align:middle;margin-right:12px">G</div>
        <span style="font-size:22px;font-weight:800;color:#fff;vertical-align:middle">CFO Genie</span>
      </td>
      <td align="right">
        <div style="font-size:11px;color:rgba(255,255,255,0.8)">Financial Summary</div>
        <div style="font-size:12px;font-weight:600;color:#fff">${dateStr}</div>
      </td>
    </tr></table>
    <div style="margin-top:16px;font-size:26px;font-weight:800;color:#fff">Good morning</div>
    <div style="margin-top:6px;font-size:14px;color:rgba(255,255,255,0.88);line-height:1.5">
      ${introText || "Here's your financial intelligence briefing. Your business is moving — here's the complete picture."}
    </div>
  </td></tr>

  <!-- KPI Row -->
  <tr><td style="background:#fff;padding:24px 36px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:16px">Key Metrics at a Glance</div>
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="25%" style="padding:0 6px 0 0">
        <div style="background:#F4F6FA;border-radius:10px;padding:14px;text-align:center;border-top:3px solid #FF681A">
          <div style="font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase;margin-bottom:6px">Total Cash</div>
          <div style="font-size:20px;font-weight:800;color:#24292E">${fmtK(d.totalCash)}</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:4px">${d.banks.length} accounts</div>
        </div>
      </td>
      <td width="25%" style="padding:0 3px">
        <div style="background:#F4F6FA;border-radius:10px;padding:14px;text-align:center;border-top:3px solid #16A34A">
          <div style="font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase;margin-bottom:6px">Revenue YTD</div>
          <div style="font-size:20px;font-weight:800;color:#24292E">${fmtK(d.ytdRev)}</div>
          <div style="font-size:10px;color:#16A34A;margin-top:4px">${d.ytdTgt?Math.round((d.ytdRev/d.ytdTgt)*100):0}% of target</div>
        </div>
      </td>
      <td width="25%" style="padding:0 3px">
        <div style="background:#F4F6FA;border-radius:10px;padding:14px;text-align:center;border-top:3px solid #2563EB">
          <div style="font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase;margin-bottom:6px">Receivables</div>
          <div style="font-size:20px;font-weight:800;color:#24292E">${fmtK(d.totalAR)}</div>
          <div style="font-size:10px;color:${d.overdueAR>0?'#DC2626':'#16A34A'};margin-top:4px">${d.overdueAR>0?fmtK(d.overdueAR)+' overdue':'All current'}</div>
        </div>
      </td>
      <td width="25%" style="padding:0 0 0 6px">
        <div style="background:#F4F6FA;border-radius:10px;padding:14px;text-align:center;border-top:3px solid #DC2626">
          <div style="font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase;margin-bottom:6px">Liabilities</div>
          <div style="font-size:20px;font-weight:800;color:#24292E">${fmtK(d.totalLiab)}</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:4px">${d.liabilities.length} categories</div>
        </div>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Financial Ratios -->
  <tr><td style="background:#fff;padding:0 36px 24px">
    <div style="background:#FFF7F5;border:1px solid #FFD4C0;border-radius:10px;padding:16px 20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#B84A0E;margin-bottom:12px">Financial Health Ratios</div>
      <table width="100%"><tr>
        <td width="25%" style="text-align:center">
          <div style="font-size:22px;font-weight:800;color:${Number(d.currentRatio)>=2?'#16A34A':Number(d.currentRatio)>=1?'#D97706':'#DC2626'}">${d.currentRatio}x</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Current Ratio</div>
        </td>
        <td width="25%" style="text-align:center">
          <div style="font-size:22px;font-weight:800;color:${Number(d.quickRatio)>=1?'#16A34A':'#D97706'}">${d.quickRatio}x</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Quick Ratio</div>
        </td>
        <td width="25%" style="text-align:center">
          <div style="font-size:22px;font-weight:800;color:${d.margin>20?'#16A34A':d.margin>10?'#D97706':'#DC2626'}">${d.margin}%</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Profit Margin</div>
        </td>
        <td width="25%" style="text-align:center">
          <div style="font-size:22px;font-weight:800;color:${d.dso<30?'#16A34A':d.dso<60?'#D97706':'#DC2626'}">${d.dso}d</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Days Sales Outstanding</div>
        </td>
      </tr></table>
    </div>
  </td></tr>

  <!-- Cash by Bank -->
  <tr><td style="background:#fff;padding:0 36px 24px">
    <table width="100%" style="border-top:1px solid #EDF0F5;padding-top:20px">
    <tr><td colspan="3" style="padding-bottom:12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF">Cash by Bank</div>
    </td></tr>
    ${d.banks.map(b=>{
      const bRes=d.reserves.filter(r=>r.bank===b.name).reduce((s,r)=>s+r.amount,0);
      const avail=b.total-bRes;
      const pct=Math.round((avail/d.totalCash)*100);
      return `<tr>
        <td width="38%" style="padding:8px 0;font-size:12px;font-weight:600;color:#24292E">${b.name}</td>
        <td width="46%" style="padding:8px 0">
          <div style="height:6px;background:#EDF0F5;border-radius:3px;overflow:hidden">
            <div style="height:100%;background:#FF681A;border-radius:3px;width:${pct}%"></div>
          </div>
          <div style="font-size:10px;color:#97A0AF;margin-top:3px">${b.type} · ${b.currency}</div>
        </td>
        <td width="16%" style="text-align:right;padding:8px 0;font-size:13px;font-weight:800;color:#24292E">${fmt(b.total)}</td>
      </tr>`;
    }).join('')}
    <tr>
      <td colspan="2" style="border-top:2px solid #EDF0F5;padding-top:10px;font-size:12px;font-weight:700;color:#5E6C84">Available (after reserves)</td>
      <td style="border-top:2px solid #EDF0F5;padding-top:10px;text-align:right;font-size:14px;font-weight:800;color:#16A34A">${fmt(d.available)}</td>
    </tr>
    </table>
  </td></tr>

  <!-- AR Breakdown -->
  <tr><td style="background:#fff;padding:0 36px 24px">
    <div style="border-top:1px solid #EDF0F5;padding-top:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:12px">Accounts Receivable — Outstanding</div>
      <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="background:#F4F6FA">
        <td style="padding:8px 10px;font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase;border-radius:6px 0 0 0">Client</td>
        <td style="padding:8px 10px;font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase">Invoice</td>
        <td style="padding:8px 10px;font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase">Due</td>
        <td style="padding:8px 10px;font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase;text-align:right">Amount</td>
        <td style="padding:8px 10px;font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase;border-radius:0 6px 0 0">Status</td>
      </tr>
      ${arRows.map((x,i)=>`
      <tr style="background:${i%2===0?'#fff':'#F9FAFB'}">
        <td style="padding:9px 10px;font-size:12px;font-weight:600;color:#24292E">${x.client}</td>
        <td style="padding:9px 10px;font-size:11px;color:#5E6C84;font-family:monospace">${x.invoice||'—'}</td>
        <td style="padding:9px 10px;font-size:11px;color:#5E6C84">${x.dueDate||'—'}</td>
        <td style="padding:9px 10px;font-size:13px;font-weight:800;color:#24292E;text-align:right">${fmt(x.amount)}</td>
        <td style="padding:9px 10px">
          <span style="background:${statusBg(x.status)};color:${statusColor(x.status)};font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;text-transform:capitalize">${x.status}</span>
        </td>
      </tr>`).join('')}
      <tr style="background:#FFF7F5">
        <td colspan="3" style="padding:10px;font-size:12px;font-weight:700;color:#24292E">Total Outstanding</td>
        <td style="padding:10px;font-size:14px;font-weight:800;color:#FF681A;text-align:right">${fmt(d.totalAR)}</td>
        <td style="padding:10px">
          ${d.overdueAR>0?`<span style="background:#FEF2F2;color:#DC2626;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px">${fmt(d.overdueAR)} OVERDUE</span>`:'<span style="background:#F0FDF4;color:#16A34A;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px">ALL CURRENT</span>'}
        </td>
      </tr>
      </table>
    </div>
  </td></tr>

  <!-- Liabilities -->
  <tr><td style="background:#fff;padding:0 36px 24px">
    <div style="border-top:1px solid #EDF0F5;padding-top:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:12px">Liabilities — Category Breakdown</div>
      ${top4Liab.map(cat=>{
        const catTotal=(cat.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0);
        const pct=d.totalLiab?Math.round((catTotal/d.totalLiab)*100):0;
        return `<div style="margin-bottom:12px">
          <table width="100%"><tr>
            <td style="font-size:12px;font-weight:600;color:#24292E">${cat.name}</td>
            <td style="text-align:right;font-size:13px;font-weight:800;color:#DC2626">${fmt(catTotal)}</td>
          </tr></table>
          <div style="height:5px;background:#EDF0F5;border-radius:3px;overflow:hidden;margin:5px 0 3px">
            <div style="height:100%;background:#DC2626;border-radius:3px;width:${pct}%"></div>
          </div>
          <div style="font-size:10px;color:#97A0AF">${pct}% of total · ${cat.breakdown?.length||0} items</div>
        </div>`;
      }).join('')}
      ${otherLiab>0?`
      <div style="background:#F4F6FA;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <span style="font-size:12px;color:#5E6C84">Other Liabilities</span>
        <span style="font-size:13px;font-weight:700;color:#5E6C84">${fmt(otherLiab)}</span>
      </div>`:``}
      <div style="border-top:2px solid #EDF0F5;margin-top:14px;padding-top:10px;display:flex;justify-content:space-between">
        <span style="font-size:13px;font-weight:700;color:#24292E">Total Liabilities</span>
        <span style="font-size:15px;font-weight:800;color:#DC2626">${fmt(d.totalLiab)}</span>
      </div>
    </div>
  </td></tr>

  <!-- Pipeline Summary -->
  <tr><td style="background:#fff;padding:0 36px 24px">
    <div style="border-top:1px solid #EDF0F5;padding-top:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:12px">Sales Pipeline</div>
      <table width="100%"><tr>
        <td width="33%" style="text-align:center;padding:12px;background:#F4F6FA;border-radius:8px;margin-right:6px">
          <div style="font-size:18px;font-weight:800;color:#24292E">${fmtK(d.pipeline.reduce((s,x)=>s+x.value,0))}</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Total Pipeline</div>
        </td>
        <td width="6%"></td>
        <td width="33%" style="text-align:center;padding:12px;background:#FFF7F5;border-radius:8px">
          <div style="font-size:18px;font-weight:800;color:#FF681A">${fmtK(d.pipeWtd)}</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Weighted Forecast</div>
        </td>
        <td width="6%"></td>
        <td width="22%" style="text-align:center;padding:12px;background:#F0FDF4;border-radius:8px">
          <div style="font-size:18px;font-weight:800;color:#16A34A">${d.pipeline.filter(x=>x.stage==='Closed Won').length}</div>
          <div style="font-size:10px;color:#5E6C84;margin-top:3px">Closed Won</div>
        </td>
      </tr></table>
    </div>
  </td></tr>

  <!-- Ayla Insight -->
  ${(()=>{
    const insights=[];
    if(d.overdueAR>20000) insights.push(`<strong>${fmt(d.overdueAR)} in overdue AR</strong> — initiate collection follow-ups immediately`);
    if(d.margin<15) insights.push(`Profit margin at ${d.margin}% — review cost structure to improve toward 20%+ target`);
    if(Number(d.currentRatio)<1.5) insights.push(`Current ratio ${d.currentRatio}x — below the 2.0x healthy threshold`);
    const renewSoon=d.clients.filter(c=>{const days=Math.ceil((new Date(c.renewal)-d.TODAY)/864e5);return days>=0&&days<60;});
    if(renewSoon.length) insights.push(`${renewSoon.length} client contract${renewSoon.length>1?'s':''} renewing within 60 days: ${renewSoon.map(c=>c.name).join(', ')}`);
    if(!insights.length) return '';
    return `<tr><td style="background:#fff;padding:0 36px 24px">
      <div style="background:linear-gradient(135deg,#FFF7F5,#FFFFFF);border:1px solid #FFD4C0;border-radius:10px;padding:18px 20px">
        <div style="font-size:12px;font-weight:700;color:#B84A0E;margin-bottom:10px">Ayla's Insights for You</div>
        ${insights.map(i=>`<div style="font-size:12px;color:#5E6C84;padding:5px 0;border-bottom:1px solid #FFE8D9;line-height:1.5">${i}</div>`).join('')}
      </div>
    </td></tr>`;
  })()}

  <!-- CTA -->
  <tr><td style="background:#fff;padding:0 36px 32px;border-radius:0 0 14px 14px;text-align:center">
    <div style="border-top:1px solid #EDF0F5;padding-top:24px">
      <p style="font-size:13px;color:#5E6C84;margin:0 0 18px">Review all details, update actuals, and take action in your CFO dashboard.</p>
      <a href="${baseUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF681A,#FF8C4A);color:#fff;padding:14px 36px;border-radius:9px;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:.02em;box-shadow:0 4px 14px rgba(255,104,26,0.35)">
        Open CFO Genie Dashboard →
      </a>
    </div>
    <p style="font-size:10px;color:#C7CFDB;margin:20px 0 0">CFO Genie · Financial Intelligence Platform · ${new Date().getFullYear()}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// â”€â”€ GET /api/reports/preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const previewHandler = (req, res) => {
  const d = getData();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type','text/html').send(buildEmailHTML(d, baseUrl));
};
router.get('/preview', previewHandler);

// â”€â”€ GET /api/reports/pipeline-preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/pipeline-preview', (req, res) => {
  const appSettings = load('app-settings.json', {});
  const staleAfter = appSettings.pipelineStaleAfterDays || 14;
  const today = dubaiNow();
  const staleDate = new Date(today.getTime() - staleAfter*24*60*60*1000);
  const deals = load('pipeline.json', seed().pipeline);
  const open = deals.filter(d => d.stage!=='Closed Won' && d.stage!=='Closed Lost');
  const stale = open.filter(d => !d.lastUpdated || new Date(d.lastUpdated) < staleDate);
  const followUpToday = open.filter(d => d.followUpDate === today.toISOString().split('T')[0]);
  const totalWtd = open.reduce((s,d)=>s+d.value*(d.probability/100),0);
  const closedWon = deals.filter(d=>d.stage==='Closed Won');

  const rows = open.sort((a,b)=>b.value-a.value).slice(0,15).map(d=>{
    const isStale = !d.lastUpdated || new Date(d.lastUpdated) < staleDate;
    const needsFollowup = d.followUpDate && d.followUpDate <= today.toISOString().split('T')[0];
    return `<tr style="border-bottom:1px solid #E4E7EC;${isStale?'background:#FFFBEB':''}">
      <td style="padding:9px 10px;font-size:12px;font-weight:600;color:#24292E">${d.name}<br><span style="font-size:10px;color:#97A0AF;font-weight:400">${d.client||''}</span></td>
      <td style="padding:9px 10px;font-size:11px"><span style="background:#F4F6FA;padding:2px 8px;border-radius:4px;font-weight:600;color:#5E6C84">${d.stage}</span></td>
      <td style="padding:9px 10px;font-size:12px;text-align:right;font-weight:700;color:#24292E">${fmt(d.value)}</td>
      <td style="padding:9px 10px;font-size:12px;text-align:center;color:#FF681A;font-weight:600">${d.probability}%</td>
      <td style="padding:9px 10px;font-size:11px;color:#5E6C84">${d.owner||'—'}</td>
      <td style="padding:9px 10px;font-size:11px;color:${needsFollowup?'#DC2626':'#16A34A'}">${d.followUpDate||'—'}</td>
      <td style="padding:9px 10px;font-size:11px;color:${isStale?'#DC2626':'#16A34A'}">${d.lastUpdated||'Never'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pipeline Digest Preview</title></head>
<body style="margin:0;padding:30px;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">
  <div style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);padding:28px 32px">
    <div style="font-size:11px;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">${today.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
    <div style="font-size:26px;font-weight:800;color:#fff">Pipeline Digest</div>
    <div style="font-size:13px;color:rgba(255,255,255,.85);margin-top:6px">Your real-time deal intelligence — ${open.length} active opportunities</div>
  </div>
  <div style="padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="8">
    <tr>
      <td width="25%" style="background:#F4F6FA;border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;color:#97A0AF;text-transform:uppercase;font-weight:600">Open Deals</div><div style="font-size:22px;font-weight:800;color:#24292E;margin-top:4px">${open.length}</div></td>
      <td width="25%" style="background:#FFF7F5;border-radius:10px;padding:14px;text-align:center;border-top:3px solid #FF681A"><div style="font-size:10px;color:#97A0AF;text-transform:uppercase;font-weight:600">Weighted Value</div><div style="font-size:22px;font-weight:800;color:#FF681A;margin-top:4px">${fmt(totalWtd)}</div></td>
      <td width="25%" style="background:${stale.length?'#FEF2F2':'#F0FDF4'};border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;color:#97A0AF;text-transform:uppercase;font-weight:600">Stale Deals</div><div style="font-size:22px;font-weight:800;color:${stale.length?'#DC2626':'#16A34A'};margin-top:4px">${stale.length}</div></td>
      <td width="25%" style="background:#F0FDF4;border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;color:#97A0AF;text-transform:uppercase;font-weight:600">Closed Won</div><div style="font-size:22px;font-weight:800;color:#16A34A;margin-top:4px">${closedWon.length}</div></td>
    </tr>
    </table>
    ${followUpToday.length?`<div style="margin-top:16px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px 18px"><div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:8px">ðŸ“… Follow-ups Due Today (${followUpToday.length})</div>${followUpToday.map(d=>`<div style="font-size:12px;color:#24292E;padding:3px 0;border-bottom:.5px solid #FDE68A">· <strong>${d.name}</strong> · ${d.owner||'Unassigned'} · <span style="color:#D97706">${d.stage}</span></div>`).join('')}</div>`:''}
    ${stale.length?`<div style="margin-top:12px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:14px 18px"><div style="font-size:12px;font-weight:700;color:#7F1D1D;margin-bottom:8px">! Stale Deals — No update in ${staleAfter}+ days</div>${stale.map(d=>`<div style="font-size:12px;color:#24292E;padding:3px 0;border-bottom:.5px solid #FCA5A5">· <strong>${d.name}</strong> · ${d.owner||'—'} · Last: <span style="color:#DC2626">${d.lastUpdated||'never'}</span></div>`).join('')}</div>`:''}
    <div style="margin-top:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#97A0AF;margin-bottom:10px">All Active Deals</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#F4F6FA"><th style="padding:8px 10px;text-align:left;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Deal</th><th style="padding:8px 10px;text-align:left;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Stage</th><th style="padding:8px 10px;text-align:right;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Value</th><th style="padding:8px 10px;text-align:center;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Prob</th><th style="padding:8px 10px;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Owner</th><th style="padding:8px 10px;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Follow-up</th><th style="padding:8px 10px;font-size:10px;color:#97A0AF;font-weight:600;text-transform:uppercase">Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
  <div style="background:#F4F6FA;padding:14px 32px;font-size:10px;color:#97A0AF;text-align:center">CFO Genie · Pipeline Digest Preview · ${new Date().getFullYear()}</div>
</div>
</body></html>`;
  res.set('Content-Type','text/html').send(html);
});

// â”€â”€ POST /api/reports/send-email — send to configured address â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/send-email', async (req, res) => {
  const appSettings = load('app-settings.json', {});
  const perType = (appSettings.financialReportRecipients || []).filter(Boolean);
  const globalList = [appSettings.ceoEmail, appSettings.cpoEmail, ...(appSettings.reportRecipients||[])].filter(Boolean);
  const resolvedList = perType.length ? perType : globalList;
  const to = req.body.to || (resolvedList.length ? resolvedList.join(',') : null);
  if (!to) return res.status(400).json({ error: 'No recipients — set CEO email in Reports → Notification Recipients, or set REPORT_EMAIL in .env' });

  if (!mailer.isConfigured()) {
    return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });
  }

  try {
    const d       = getData();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const tplCfg  = load('app-settings.json', {});
    const tpl     = tplCfg.emailTemplates?.financial || {};
    const dateStr = dubaiNow().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Dubai'});
    const subject = (tpl.subject || 'CFO Genie Financial Summary - {{date}}').replace('{{date}}', dateStr);
    const html    = buildEmailHTML(d, baseUrl, { intro: tpl.intro });
    await mailer.sendMail({ to, subject, html });
    _appendEmailLog('Financial Report', to, 'sent', `Report sent to ${to}`);
    res.json({ ok: true, message: `Report sent to ${to}` });
  } catch(e) {
    _appendEmailLog('Financial Report', to || '(none)', 'failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /api/reports/send-test-email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/send-test-email', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });
  try {
    const d       = getData();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const tplCfg  = load('app-settings.json', {});
    const tpl     = tplCfg.emailTemplates?.financial || {};
    const dateStr = dubaiNow().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Dubai'});
    const subject = '[TEST] ' + (tpl.subject || 'CFO Genie Financial Summary — {{date}}').replace('{{date}}', dateStr);
    const html    = buildEmailHTML(d, baseUrl, { intro: tpl.intro });
    await mailer.sendMail({ to, subject, html });
    _appendEmailLog('Test Email', to, 'sent', `Test email sent to ${to}`);
    res.json({ ok: true, message: `Test email sent to ${to}` });
  } catch(e) {
    _appendEmailLog('Test Email', to, 'failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ PUT /api/reports/email-templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/email-templates', requireRole('finance'), (req, res) => {
  const cfg = load('app-settings.json', {});
  cfg.emailTemplates = { ...(cfg.emailTemplates || {}), ...req.body };
  save('app-settings.json', cfg);
  res.json({ ok: true });
});

router.get('/email-templates', (req, res) => {
  const cfg = load('app-settings.json', {});
  res.json(cfg.emailTemplates || {});
});

// ── POST /api/reports/send-ceo-reminders — ONE email with ALL pending tasks ──
router.post('/send-ceo-reminders', async (req, res) => {
  const appSettings = load('app-settings.json', {});
  const taskRole    = req.body.taskRole || 'ceo';
  const perTypeKey  = taskRole === 'cpo' ? 'cpoReminderRecipients' : 'ceoReminderRecipients';
  const perType     = (appSettings[perTypeKey] || []).filter(Boolean);
  const toEmail     = req.body.ceoEmail || (perType.length ? perType.join(',') : null) || process.env.CEO_EMAIL;
  const baseUrl     = `${req.protocol}://${req.get('host')}`;
  const roleLabel   = taskRole === 'cpo' ? 'CPO' : 'CEO';

  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });
  if (!toEmail) return res.status(400).json({ error: `Set ${roleLabel} reminder recipients in Reports → Task Reminders` });

  const tasks  = load('tasks.json', seed().tasks);
  const crypto = require('crypto');
  // Manual send - no cooldown, always send all pending non-done tasks
  const pending = tasks.filter(t => t.taskType === taskRole && !t.done);

  if (!pending.length) return res.json({ ok: true, sent: 0, message: `No pending ${roleLabel} reminders` });

  pending.forEach(t => { if (!t.completionToken) t.completionToken = crypto.randomBytes(16).toString('hex'); });

  const motivations = [
    { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { quote: "Don't watch the clock; do what it does. Keep going.", author: 'Sam Levenson' },
    { quote: "It always seems impossible until it's done.", author: 'Nelson Mandela' },
    { quote: 'Vision without execution is just hallucination.', author: 'Thomas Edison' },
    { quote: 'Revenue is vanity, profit is sanity, cash is king.', author: 'Business Wisdom' },
    { quote: 'Move fast and build things that last.', author: 'CFO Genie' },
  ];
  const motivation    = motivations[Math.floor(Math.random() * motivations.length)];
  const priorityColor = p => ({ high:'#DC2626', medium:'#D97706', low:'#16A34A' }[p] || '#5E6C84');
  const priorityBg    = p => ({ high:'#FEF2F2', medium:'#FFFBEB', low:'#F0FDF4' }[p] || '#F4F6FA');
  const dateStr       = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});
  const hasOverdue    = pending.some(t => t.deadline && new Date(t.deadline+'T00:00:00') < dubaiNow());

  const taskCards = pending.map(task => {
    const isOverdue = task.deadline && new Date(task.deadline+'T00:00:00') < dubaiNow();
    const doneLink  = `${baseUrl}/api/tasks/complete-by-token/${task.completionToken}`;
    return `
    <div style="border:1.5px solid ${isOverdue?'#FCA5A5':'#E4E7EC'};border-radius:12px;overflow:hidden;margin-bottom:14px">
      <div style="padding:16px 20px;background:${isOverdue?'#FEF2F2':'#FAFBFC'}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            ${isOverdue?'<div style="font-size:10px;font-weight:700;color:#DC2626;margin-bottom:6px">OVERDUE</div>':''}
            <div style="font-size:15px;font-weight:800;color:#24292E;line-height:1.35;margin-bottom:8px">${task.title}</div>
            <span style="background:${priorityBg(task.priority)};color:${priorityColor(task.priority)};font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:capitalize">${task.priority||'normal'} priority</span>
            ${task.deadline?`<span style="margin-left:8px;font-size:11px;font-weight:600;color:${isOverdue?'#DC2626':'#5E6C84'}">Due: ${task.deadline}</span>`:''}
          </div>
          <a href="${doneLink}" style="flex-shrink:0;display:inline-block;background:linear-gradient(135deg,#16A34A,#22C55E);color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:12px;white-space:nowrap">Mark Done</a>
        </div>
        ${task.ceoNote?`<div style="margin-top:10px;padding:10px 14px;background:#fff;border-radius:8px;border:1px solid #E4E7EC;font-size:12px;color:#5E6C84;line-height:1.6">${task.ceoNote}</div>`:''}
      </div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><title>${roleLabel} Task Reminders</title></head>
<body style="margin:0;padding:0;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF0F5;padding:30px 0">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%">
  <tr><td style="background:linear-gradient(135deg,${hasOverdue?'#DC2626 0%,#EF4444':'#FF681A 0%,#FF8C4A'} 100%);border-radius:14px 14px 0 0;padding:28px 32px">
    <table width="100%"><tr>
      <td><span style="font-size:17px;font-weight:800;color:#fff">CFO Genie</span></td>
      <td align="right"><div style="font-size:10px;color:rgba(255,255,255,.75);text-transform:uppercase">${roleLabel} Task Reminders</div>
        <div style="font-size:11px;color:#fff;margin-top:2px">${dateStr}</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#fff;padding:28px 32px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:16px">${pending.length} Pending Task${pending.length>1?'s':''}</div>
    ${taskCards}
    <div style="margin-top:8px"><a href="${baseUrl}" style="display:block;background:#F4F6FA;color:#24292E;padding:12px 16px;border-radius:9px;text-decoration:none;font-weight:600;font-size:13px;text-align:center;border:1.5px solid #E4E7EC">Open Dashboard</a></div>
  </td></tr>
  <tr><td style="background:#FFF7F5;padding:18px 32px;border-top:1px solid #FFE4D0">
    <div style="font-size:11px;font-style:italic;color:#5E6C84">"${motivation.quote}" — ${motivation.author}</div>
  </td></tr>
  <tr><td style="background:#F4F6FA;padding:12px 32px;border-radius:0 0 14px 14px;text-align:center">
    <p style="font-size:10px;color:#C7CFDB;margin:0">CFO Genie Task Reminder System</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

  try {
    const overdueCount = pending.filter(t => t.deadline && new Date(t.deadline+'T00:00:00') < dubaiNow()).length;
    const subjectTag = overdueCount ? `[OVERDUE] ` : '';
    await mailer.sendMail({ to: toEmail, subject: `[CFO Genie] ${subjectTag}${roleLabel} Tasks: ${pending.length} pending reminder${pending.length>1?'s':''}`, html });
    pending.forEach(t => { t.lastReminderSent = new Date().toISOString(); });
    save('tasks.json', tasks);
    _appendEmailLog(`${roleLabel} Task Reminders`, toEmail, 'sent', `${pending.length} task${pending.length>1?'s':''} in 1 email to ${toEmail}`);
    res.json({ ok: true, sent: pending.length, message: `${pending.length} task${pending.length>1?'s':''} sent in 1 email to ${toEmail}` });
  } catch(e) {
    _appendEmailLog(`${roleLabel} Task Reminders`, toEmail || '(none)', 'failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /api/reports/send-pipeline-digest — pipeline summary email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/send-pipeline-digest', async (req, res) => {
  const appSettings = load('app-settings.json', {});
  const perType = (appSettings.pipelineDigestRecipients || []).filter(Boolean);
  const globalList = [appSettings.ceoEmail || process.env.CEO_EMAIL, appSettings.cpoEmail || process.env.CPO_EMAIL, ...(appSettings.reportRecipients||[])].filter(Boolean);
  const recipients = [...new Set(perType.length ? perType : globalList)];
  if (!recipients.length) return res.status(400).json({ error: 'No recipients configured — set CEO email in Reports → Notification Recipients' });

  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });

  const deals = load('pipeline.json', seed().pipeline);
  const staleAfter = appSettings.pipelineStaleAfterDays || 14;
  const today = dubaiNow();
  const staleDate = new Date(today.getTime() - staleAfter*24*60*60*1000);

  const open = deals.filter(d => d.stage!=='Closed Won' && d.stage!=='Closed Lost');
  const stale = open.filter(d => !d.lastUpdated || new Date(d.lastUpdated) < staleDate);
  const followUpToday = open.filter(d => d.followUpDate === today.toISOString().split('T')[0]);
  const totalWtd = open.reduce((s,d)=>s+d.value*(d.probability/100),0);

  const rows = open.sort((a,b)=>b.value-a.value).slice(0,10).map(d=>`
    <tr style="border-bottom:1px solid #E4E7EC">
      <td style="padding:8px 10px;font-size:13px;color:#24292E">${d.name}</td>
      <td style="padding:8px 10px;font-size:13px">${d.stage}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;font-weight:600">${fmt(d.value)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center">${d.probability}%</td>
      <td style="padding:8px 10px;font-size:13px">${d.owner||'—'}</td>
      <td style="padding:8px 10px;font-size:11px;color:${!d.lastUpdated||new Date(d.lastUpdated)<staleDate?'#DC2626':'#16A34A'}">${d.lastUpdated||'Never'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#EDF0F5;padding:24px">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#FF681A,#FF8C4A);padding:24px 28px">
      <div style="font-size:12px;color:rgba(255,255,255,.8)">${dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'})}</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-top:4px">Pipeline Digest</div>
    </div>
    <div style="padding:24px 28px">
      <div style="display:flex;gap:20px;margin-bottom:20px">
        <div style="flex:1;background:#F4F6FA;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Open Deals</div><div style="font-size:22px;font-weight:800;color:#24292E">${open.length}</div></div>
        <div style="flex:1;background:#F4F6FA;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Weighted Forecast</div><div style="font-size:22px;font-weight:800;color:#FF681A">${fmt(totalWtd)}</div></div>
        <div style="flex:1;background:${stale.length?'#FEF2F2':'#F0FDF4'};border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Stale (${staleAfter}d+)</div><div style="font-size:22px;font-weight:800;color:${stale.length?'#DC2626':'#16A34A'}">${stale.length}</div></div>
        <div style="flex:1;background:#F0FDF4;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Follow-ups Today</div><div style="font-size:22px;font-weight:800;color:#16A34A">${followUpToday.length}</div></div>
      </div>
      ${followUpToday.length?`<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:6px">ðŸ“… Follow-ups Due Today</div>${followUpToday.map(d=>`<div style="font-size:12px;color:#24292E;padding:3px 0">· <strong>${d.name}</strong> (${d.owner||'unassigned'}) — ${d.stage}</div>`).join('')}</div>`:''}
      ${stale.length?`<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px 16px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:#7F1D1D;margin-bottom:6px">! Stale Deals (no update in ${staleAfter}+ days)</div>${stale.map(d=>`<div style="font-size:12px;color:#24292E;padding:3px 0">· <strong>${d.name}</strong> — ${d.stage} · Owner: ${d.owner||'—'} · Last update: ${d.lastUpdated||'never'}</div>`).join('')}</div>`:''}
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#F4F6FA"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#97A0AF">Deal</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#97A0AF">Stage</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#97A0AF">Value</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#97A0AF">Prob</th><th style="padding:8px 10px;font-size:11px;color:#97A0AF">Owner</th><th style="padding:8px 10px;font-size:11px;color:#97A0AF">Last Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="background:#F4F6FA;padding:14px 28px;font-size:10px;color:#97A0AF;text-align:center">CFO Genie · Pipeline Digest · ${new Date().getFullYear()}</div>
  </div></body></html>`;

  try {
    await mailer.sendMail({ to: recipients.join(','), subject: `Pipeline Digest — ${open.length} open, ${fmt(totalWtd)} weighted · ${dubaiNow().toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'Asia/Dubai'})}`, html });
    _appendEmailLog('Pipeline Digest', recipients.join(', '), 'sent', `Digest sent to ${recipients.join(', ')}`);
    res.json({ ok: true, message: `Digest sent to ${recipients.join(', ')}` });
  } catch(e) {
    _appendEmailLog('Pipeline Digest', recipients.join(', '), 'failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /api/reports/send-salesperson-digest — personalized pipeline digest â”€â”€â”€
router.post('/send-salesperson-digest', async (req, res) => {
  const { owner, email } = req.body;
  if (!owner?.trim()) return res.status(400).json({ error: 'Salesperson name required' });
  if (!email?.trim()) return res.status(400).json({ error: 'Recipient email required' });
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });

  const allDeals = load('pipeline.json', seed().pipeline);
  const deals    = allDeals.filter(d => (d.owner||'').toLowerCase() === owner.trim().toLowerCase());
  const open     = deals.filter(d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost');
  const won      = deals.filter(d => d.stage === 'Closed Won');
  const totalWtd = open.reduce((s,d) => s + d.value * (d.probability / 100), 0);
  const totalWon = won.reduce((s,d) => s + d.value, 0);
  const stageColor = s => ({ 'Closed Won':'#16A34A','Negotiation':'#FF681A','Proposal':'#D97706','Qualification':'#7C3AED','Prospecting':'#2563EB','On Hold':'#97A0AF' }[s] || '#97A0AF');
  const fmtV = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v||0);
  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});

  const dealRows = open.sort((a,b)=>b.value-a.value).map(d=>`
    <tr style="border-bottom:1px solid #E4E7EC">
      <td style="padding:10px 12px"><div style="font-size:13px;font-weight:600;color:#24292E">${d.name}</div>${d.client?`<div style="font-size:11px;color:#97A0AF">${d.client}</div>`:''}</td>
      <td style="padding:10px 12px"><span style="font-size:11px;font-weight:700;color:${stageColor(d.stage)}">${d.stage}</span></td>
      <td style="padding:10px 12px;text-align:right;font-weight:700;color:#24292E">${fmtV(d.value)}</td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;color:#5E6C84">${d.probability}%</td>
      <td style="padding:10px 12px;text-align:right;font-weight:600;color:#FF681A">${fmtV(d.value*(d.probability/100))}</td>
      <td style="padding:10px 12px;font-size:11px;color:#97A0AF">${d.closeDate||'—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Pipeline Digest</title></head>
<body style="margin:0;padding:0;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EDF0F5;padding:32px 0"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);border-radius:14px 14px 0 0;padding:28px 32px">
    <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px">Aladdin Finance · Pipeline Digest</div>
    <div style="font-size:24px;font-weight:800;color:#fff;margin-bottom:4px">Hi ${owner.trim().split(' ')[0]},</div>
    <div style="font-size:13px;color:rgba(255,255,255,.85);line-height:1.5">Here's your personal pipeline summary for ${dateStr}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:28px 32px">
    <div style="display:flex;gap:14px;margin-bottom:22px;flex-wrap:wrap">
      <div style="flex:1;min-width:100px;background:#FFF7F5;border:1px solid #FFD4C0;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:#97A0AF;margin-bottom:4px">Open Deals</div>
        <div style="font-size:24px;font-weight:800;color:#FF681A">${open.length}</div>
      </div>
      <div style="flex:1;min-width:100px;background:#FFF7F5;border:1px solid #FFD4C0;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:#97A0AF;margin-bottom:4px">Weighted Forecast</div>
        <div style="font-size:22px;font-weight:800;color:#FF681A">${fmtV(totalWtd)}</div>
      </div>
      <div style="flex:1;min-width:100px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:#97A0AF;margin-bottom:4px">Closed Won</div>
        <div style="font-size:22px;font-weight:800;color:#16A34A">${fmtV(totalWon)}</div>
      </div>
    </div>
    ${open.length ? `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#F4F6FA">
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:#97A0AF;font-weight:700;text-transform:uppercase">Deal</th>
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:#97A0AF;font-weight:700;text-transform:uppercase">Stage</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;color:#97A0AF;font-weight:700;text-transform:uppercase">Value</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;color:#97A0AF;font-weight:700;text-transform:uppercase">Prob</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;color:#97A0AF;font-weight:700;text-transform:uppercase">Wtd</th>
        <th style="padding:8px 12px;font-size:10px;color:#97A0AF;font-weight:700;text-transform:uppercase">Close</th>
      </tr></thead>
      <tbody>${dealRows}</tbody>
    </table>` : `<div style="text-align:center;padding:24px;color:#97A0AF;font-size:13px">No open deals at the moment. Keep pushing!</div>`}
  </td></tr>
  <tr><td style="background:#0F1B2D;border-radius:0 0 14px 14px;padding:16px 32px;text-align:center">
    <div style="font-size:13px;font-weight:700;color:#FF681A;margin-bottom:3px">Aladdin Finance</div>
    <div style="font-size:10px;color:rgba(255,255,255,.3)">Pipeline Digest System · ${new Date().getFullYear()}</div>
  </td></tr>
</table></td></tr></table></body></html>`;

  try {
    await mailer.sendMail({ to: email.trim(), subject: `Your Pipeline — ${open.length} open · ${fmtV(totalWtd)} weighted · ${dubaiNow().toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'Asia/Dubai'})}`, html });
    _appendEmailLog(`Pipeline Digest (${owner})`, email.trim(), 'sent', `Digest sent to ${email.trim()}`);
    res.json({ ok: true, message: `Digest sent to ${email.trim()}` });
  } catch(e) {
    _appendEmailLog(`Pipeline Digest (${owner})`, email.trim(), 'failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/reports/stale-alert-preview ─────────────────────────────────────
router.get('/stale-alert-preview', (req, res) => {
  const appSettings = load('app-settings.json', {});
  const staleAfter = appSettings.pipelineStaleAfterDays || 14;
  const today = dubaiNow();
  const staleDate = new Date(today.getTime() - staleAfter*24*60*60*1000);
  const deals = load('pipeline.json', seed().pipeline);
  const stale = deals.filter(d =>
    d.stage!=='Closed Won' && d.stage!=='Closed Lost' &&
    (!d.lastUpdated || new Date(d.lastUpdated) < staleDate)
  );
  const dateStr = today.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});
  const html = buildStaleAlertHTML(stale, staleAfter, dateStr, true);
  res.set('Content-Type','text/html').send(html);
});

// ── POST /api/reports/send-stale-alerts — email deal owners about stale deals ─
router.post('/send-stale-alerts', async (req, res) => {
  const appSettings = load('app-settings.json', {});
  const staleAfter = appSettings.pipelineStaleAfterDays || 14;
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });

  const deals = load('pipeline.json', seed().pipeline);
  const staleDate = new Date(Date.now() - staleAfter*24*60*60*1000);
  const stale = deals.filter(d =>
    d.stage!=='Closed Won' && d.stage!=='Closed Lost' &&
    d.ownerEmail && (!d.lastUpdated || new Date(d.lastUpdated) < staleDate)
  );

  if (!stale.length) return res.json({ ok: true, sent: 0, message: 'No stale deals with owner emails' });

  const byOwnerEmail = {};
  stale.forEach(d => { (byOwnerEmail[d.ownerEmail] = byOwnerEmail[d.ownerEmail]||[]).push(d); });

  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});
  try {
    let sent = 0;
    for (const [email, ownerDeals] of Object.entries(byOwnerEmail)) {
      const html = buildStaleAlertHTML(ownerDeals, staleAfter, dateStr, false);
      await mailer.sendMail({ to: email, subject: `⚠ ${ownerDeals.length} deal${ownerDeals.length>1?'s':''} need your attention — CFO Genie`, html });
      sent++;
    }
    res.json({ ok: true, sent, message: `Alerts sent to ${sent} deal owner${sent>1?'s':''}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ Project Report HTML builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildProjectReportHTML(p) {
  const expenses    = p.expenses || [];
  const budgetItems = p.budgetItems || [];
  const approvedExp = expenses.filter(e => e.status !== 'rejected');
  const totalSpent  = approvedExp.reduce((a, e) => a + (e.amount||0), 0);
  const profit      = (p.linkedRevenue||0) - totalSpent;
  const margin      = p.linkedRevenue ? Math.round((profit / p.linkedRevenue) * 100) : 0;
  const over        = totalSpent > p.budget && p.budget > 0;
  const budgetPct   = p.budget ? Math.min(Math.round(totalSpent / p.budget * 100), 100) : 0;
  const barColor    = over ? '#DC2626' : budgetPct > 80 ? '#D97706' : '#16A34A';
  const dateStr     = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});

  // Timeline
  const today    = dubaiNow();
  const start    = p.startDate ? new Date(p.startDate) : null;
  const end      = p.endDate   ? new Date(p.endDate)   : null;
  const daysLeft = end ? Math.ceil((end - today) / 86400000) : null;
  const totalDays= (start && end) ? Math.ceil((end - start) / 86400000) : 1;
  const elapsed  = (start && end) ? Math.max(0, Math.min(100, Math.round(((today - start) / (end - start)) * 100))) : 0;
  const timeStr  = daysLeft === null ? 'No end date' : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft} days remaining`;
  const timeColor = daysLeft === null ? '#5E6C84' : daysLeft < 0 ? '#DC2626' : daysLeft < 14 ? '#D97706' : '#16A34A';

  // Health score (0â€“100)
  let score = 0;
  if (budgetPct <= 50)       score += 35; else if (budgetPct <= 80) score += 22; else if (budgetPct <= 100) score += 10;
  if (margin >= 60)          score += 35; else if (margin >= 30)    score += 22; else if (margin >= 0)      score += 10;
  if (daysLeft === null || daysLeft >= 14) score += 30; else if (daysLeft >= 0) score += 18; else score += 0;
  const healthLabel = score >= 75 ? 'Strong' : score >= 45 ? 'On Watch' : 'At Risk';
  const healthColor = score >= 75 ? '#16A34A' : score >= 45 ? '#D97706' : '#DC2626';
  const healthBg    = score >= 75 ? '#F0FDF4' : score >= 45 ? '#FFFBEB' : '#FEF2F2';

  // Ayla tradeshow intelligence
  const milestonesDone  = (p.milestones||[]).filter(m=>m.done).length;
  const milestonesTotal = (p.milestones||[]).length;
  const pendingExp      = expenses.filter(e => e.status === 'pending').length;
  const topBudCat       = budgetItems.length ? budgetItems.reduce((a,b)=>b.amountUsd>a.amountUsd?b:a, budgetItems[0]) : null;
  const budgetRemaining = p.budget - totalSpent;
  const aylaLines = [];
  // Budget health
  if (over) aylaLines.push(`Budget exceeded by ${fmt(totalSpent - p.budget)} — immediate review required before incurring further costs.`);
  else if (budgetPct >= 80) aylaLines.push(`${budgetPct}% of budget consumed — only ${fmt(budgetRemaining)} remaining. Tighten spend controls for remaining show days.`);
  else if (budgetPct < 40 && elapsed > 50) aylaLines.push(`Budget utilisation is low (${budgetPct}%) despite the project being ${elapsed}% through its timeline — confirm all supplier invoices have been captured.`);
  else aylaLines.push(`Budget is on track at ${budgetPct}% utilisation with ${fmt(budgetRemaining)} headroom remaining.`);
  // Revenue & margin
  if (p.linkedRevenue > 0) {
    if (margin >= 50) aylaLines.push(`Strong ${margin}% gross margin — this tradeshow is delivering excellent ROI.`);
    else if (margin >= 20) aylaLines.push(`${margin}% gross margin is acceptable; look for ways to reduce logistics and booth costs on future shows.`);
    else if (margin > 0) aylaLines.push(`Thin ${margin}% margin — negotiate better rates with booth contractors or increase sponsorship revenue for future editions.`);
    else aylaLines.push(`Project is loss-making at ${Math.abs(margin)}% — conduct a post-show cost review and revise pricing model for the next tradeshow.`);
  }
  // Timeline
  if (daysLeft !== null && daysLeft < 0) aylaLines.push(`Show date passed ${Math.abs(daysLeft)} days ago — ensure all post-show invoices and expense submissions are closed out.`);
  else if (daysLeft !== null && daysLeft <= 7 && daysLeft >= 0) aylaLines.push(`Show in ${daysLeft} day${daysLeft===1?'':'s'} — verify booth build, logistics, and staffing are confirmed.`);
  // Milestones
  if (milestonesTotal > 0 && milestonesDone < milestonesTotal) {
    const remaining = milestonesTotal - milestonesDone;
    aylaLines.push(`${remaining} milestone${remaining>1?'s':''} still open — confirm ownership and completion dates with the project manager.`);
  }
  // Pending expenses
  if (pendingExp > 0) aylaLines.push(`${pendingExp} expense${pendingExp>1?'s':''} pending approval — review and approve to keep actuals current.`);
  // Top budget item
  if (topBudCat) aylaLines.push(`Largest budget line is "${topBudCat.category}" at ${fmt(topBudCat.amountUsd)} — ensure this is tracked against actuals.`);
  const insightText = aylaLines.join(' ');

  // Milestones visual
  const msHTML = (p.milestones||[]).length ? (() => {
    const ms = p.milestones;
    const dots = ms.map((m, i) => `
      <td align="center" style="padding:0 4px;vertical-align:top">
        <div style="width:28px;height:28px;border-radius:50%;background:${m.done?'#FF681A':'#E4E7EC'};margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:12px;color:${m.done?'#fff':'#97A0AF'};font-weight:700">${m.done?'âœ“':(i+1)}</div>
        <div style="font-size:10px;color:${m.done?'#24292E':'#97A0AF'};margin-top:5px;max-width:70px;word-wrap:break-word;font-weight:${m.done?'600':'400'}">${m.title}</div>
      </td>
      ${i < ms.length-1 ? `<td style="padding-bottom:14px"><div style="height:2px;background:${m.done&&ms[i+1]?.done?'#FF681A':'#E4E7EC'};min-width:16px"></div></td>` : ''}`
    ).join('');
    return `<tr><td style="background:#fff;padding:0 36px 24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#97A0AF;margin-bottom:16px;border-top:1px solid #E4E7EC;padding-top:20px">Milestones (${milestonesDone}/${milestonesTotal} complete)</div>
      <table cellpadding="0" cellspacing="0" border="0"><tr>${dots}</tr></table>
    </td></tr>`;
  })() : '';

  // Expense rows (top 8)
  const expRows = expenses.slice(0,8).map((e, idx) => `
    <tr style="background:${idx%2===0?'#fff':'#FAFBFC'}">
      <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;font-weight:600;color:#24292E">${e.from||'—'}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;color:#5E6C84">${e.who||'—'}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;color:#97A0AF">${e.date||'—'}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;font-weight:700;text-align:right;color:#24292E">${fmt(e.amount)}</td>
    </tr>`).join('');

  const statusColors = { active:'#16A34A', completed:'#2563EB', 'on hold':'#D97706', cancelled:'#DC2626', preparing:'#7C3AED', 'under process':'#0891B2' };
  const stColor = statusColors[p.status] || '#5E6C84';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Report — ${p.name}</title>
</head>
<body style="margin:0;padding:0;background:#0F1B2D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0F1B2D;padding:40px 0 60px">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%">

  <!-- Hero Header -->
  <tr><td style="background:linear-gradient(135deg,#0F1B2D 0%,#1E3553 100%);border-radius:16px 16px 0 0;padding:36px 40px 32px;border-bottom:1px solid rgba(255,255,255,.06)">
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="font-size:10px;color:#FF681A;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px"> Project Financial Report</div>
        <div style="font-size:26px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:6px">${p.name}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.55);margin-bottom:12px">${p.client||''} ${p.manager?'· PM: '+p.manager:''}</div>
        <div style="display:inline-block;background:${stColor}22;border:1px solid ${stColor}44;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;color:${stColor};text-transform:capitalize">${p.status||'active'}</div>
      </div>
    </div>
    <!-- Timeline strip -->
    <div style="margin-top:20px;background:rgba(255,255,255,.05);border-radius:10px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;color:rgba(255,255,255,.5)">${p.startDate||'—'}</span>
        <span style="font-size:11px;font-weight:700;color:${timeColor}">${timeStr}</span>
        <span style="font-size:11px;color:rgba(255,255,255,.5)">${p.endDate||'—'}</span>
      </div>
      <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${elapsed}%;background:linear-gradient(90deg,#FF681A,#FF9E5C);border-radius:2px"></div>
      </div>
      <div style="font-size:10px;color:rgba(255,255,255,.35);margin-top:5px;text-align:right">${elapsed}% of timeline elapsed</div>
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:10px">Generated on ${dateStr}</div>
  </td></tr>

  <!-- Health Score Banner -->
  <tr><td style="background:${healthBg};padding:14px 40px;border-left:4px solid ${healthColor}">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="font-size:10px;color:${healthColor};text-transform:uppercase;letter-spacing:.08em;font-weight:700">Project Health Score</div>
        <div style="font-size:12px;color:#5E6C84;margin-top:2px">${insightText}</div>
      </td>
      <td align="right" style="white-space:nowrap;padding-left:20px">
        <div style="font-size:32px;font-weight:900;color:${healthColor};line-height:1">${score}</div>
        <div style="font-size:11px;font-weight:700;color:${healthColor}">${healthLabel}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- KPI Cards -->
  <tr><td style="background:#fff;padding:28px 40px 24px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:16px">Financial Summary</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="22%" style="background:#F8F9FC;border-radius:10px;padding:16px;text-align:center;border:1px solid #E8EBF0">
        <div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Budget</div>
        <div style="font-size:20px;font-weight:800;color:#24292E">${fmt(p.budget)}</div>
        <div style="font-size:10px;color:#97A0AF;margin-top:3px">Allocated</div>
      </td>
      <td width="4%" style="font-size:16px;color:#E4E7EC;text-align:center">→</td>
      <td width="22%" style="background:${over?'#FEF2F2':'#F8F9FC'};border-radius:10px;padding:16px;text-align:center;border:1px solid ${over?'#FECACA':'#E8EBF0'}">
        <div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Spent</div>
        <div style="font-size:20px;font-weight:800;color:${over?'#DC2626':'#24292E'}">${fmt(totalSpent)}</div>
        <div style="font-size:10px;color:${barColor};margin-top:3px;font-weight:600">${budgetPct}%${over?' ! Over budget':''}</div>
      </td>
      <td width="4%" style="font-size:16px;color:#E4E7EC;text-align:center">→</td>
      <td width="22%" style="background:#F0FDF4;border-radius:10px;padding:16px;text-align:center;border:1px solid #BBF7D0">
        <div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Revenue</div>
        <div style="font-size:20px;font-weight:800;color:#16A34A">${fmt(p.linkedRevenue)}</div>
        <div style="font-size:10px;color:#16A34A;margin-top:3px">Contracted</div>
      </td>
      <td width="4%" style="font-size:16px;color:#E4E7EC;text-align:center">=</td>
      <td width="22%" style="background:${profit>=0?'#F0FDF4':'#FEF2F2'};border-radius:10px;padding:16px;text-align:center;border:1px solid ${profit>=0?'#BBF7D0':'#FECACA'}">
        <div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Net Profit</div>
        <div style="font-size:20px;font-weight:800;color:${profit>=0?'#16A34A':'#DC2626'}">${fmt(profit)}</div>
        <div style="font-size:10px;color:${profit>=0?'#16A34A':'#DC2626'};margin-top:3px;font-weight:600">${margin}% margin</div>
      </td>
    </tr></table>

    <!-- Budget bar -->
    <div style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#97A0AF;margin-bottom:6px">
        <span style="font-weight:600;color:#5E6C84">Budget Utilization</span>
        <span style="font-weight:700;color:${barColor}">${budgetPct}% used${over?' — OVER BUDGET':''}</span>
      </div>
      <div style="height:8px;background:#E4E7EC;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${budgetPct}%;background:linear-gradient(90deg,${barColor},${barColor}cc);border-radius:4px;transition:width .4s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#C7CFDB;margin-top:4px">
        <span>$0</span><span>${fmt(p.budget)}</span>
      </div>
    </div>
  </td></tr>

  <!-- Budget Breakdown -->
  ${budgetItems.length ? `<tr><td style="background:#fff;padding:0 40px 28px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:14px;border-top:1px solid #E4E7EC;padding-top:22px">
      Budget Breakdown <span style="background:#2563EB;color:#fff;border-radius:10px;padding:2px 7px;font-size:9px;font-weight:700;margin-left:6px">${budgetItems.length} items</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E7EC;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#F8F9FC">
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:left;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Category</th>
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:left;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Description</th>
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:left;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Maps to</th>
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:right;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Budget (USD)</th>
      </thead>
      <tbody>
        ${budgetItems.map((b, idx) => `
        <tr style="background:${idx%2===0?'#fff':'#FAFBFC'}">
          <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;font-weight:600;color:#24292E">${b.category||'—'}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;color:#5E6C84">${b.description||'—'}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px">${b.financialCat?`<span style="background:#EFF6FF;color:#2563EB;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">${b.financialCat}</span>`:'<span style="color:#C7CFDB">—</span>'}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #F0F1F4;font-size:12px;font-weight:700;text-align:right;color:#24292E">${fmt(b.amountUsd||0)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr style="background:linear-gradient(90deg,#EFF6FF,#DBEAFE)">
        <td colspan="3" style="padding:14px;font-size:12px;font-weight:700;color:#2563EB;border-top:2px solid #BFDBFE">Total Budget</td>
        <td style="padding:14px;font-size:16px;font-weight:900;text-align:right;color:#2563EB;border-top:2px solid #BFDBFE">${fmt(budgetItems.reduce((s,b)=>s+(b.amountUsd||0),0))}</td>
      </tr></tfoot>
    </table>
  </td></tr>` : ''}

  ${msHTML}

  <!-- Expenses -->
  ${expenses.length ? `<tr><td style="background:#fff;padding:0 40px 28px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:14px;border-top:1px solid #E4E7EC;padding-top:22px">
      Expense Breakdown <span style="background:#FF681A;color:#fff;border-radius:10px;padding:2px 7px;font-size:9px;font-weight:700;margin-left:6px">${expenses.length}</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E7EC;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#F8F9FC">
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:left;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Description</th>
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:left;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Spent By</th>
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:left;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Date</th>
        <th style="padding:10px 14px;font-size:10px;font-weight:700;text-align:right;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #E4E7EC">Amount</th>
      </thead>
      <tbody>${expRows}</tbody>
      <tfoot><tr style="background:linear-gradient(90deg,#FFF7F5,#FFF0EA)">
        <td colspan="3" style="padding:14px;font-size:12px;font-weight:700;color:#FF681A;border-top:2px solid #FFE4D6">Total Expenditure</td>
        <td style="padding:14px;font-size:16px;font-weight:900;text-align:right;color:#FF681A;border-top:2px solid #FFE4D6">${fmt(totalSpent)}</td>
      </tr></tfoot>
    </table>
  </td></tr>` : ''}

  <!-- Ayla Analysis -->
  <tr><td style="background:#fff;padding:0 40px 28px">
    <div style="background:linear-gradient(135deg,#0F1B2D,#1E3553);border-radius:12px;padding:22px 24px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#FF681A,#FF9E5C);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🤖</div>
        <div>
          <div style="font-size:11px;font-weight:800;color:#FF681A;letter-spacing:.06em;text-transform:uppercase">Ayla — AI Analysis</div>
          <div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:1px">Tradeshow Project Intelligence</div>
        </div>
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.85);line-height:1.7">${insightText}</div>
      <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:12px;border-top:1px solid rgba(255,255,255,.06);padding-top:10px">Aladdin Finance · ${p.name} · Generated ${dateStr}</div>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0F1B2D;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;border-top:1px solid rgba(255,255,255,.05)">
    <div style="font-size:13px;font-weight:700;color:#FF681A;margin-bottom:4px">Aladdin Finance</div>
    <div style="font-size:10px;color:rgba(255,255,255,.3)">CFO Command Center · Project Report · ${new Date().getFullYear()}</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// â”€â”€ GET /api/reports/project-report-preview/:id — returns HTML for browser tab â”€
const projectReportPreviewHandler = (req, res) => {
  const { load: ld } = require('../data/store');
  const projects = ld('projects.json', []);
  const p = projects.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).send('<h2>Project not found</h2>');
  res.set('Content-Type', 'text/html').send(buildProjectReportHTML(p));
};
router.get('/project-report-preview/:id', projectReportPreviewHandler);

// â”€â”€ POST /api/reports/send-project-report/:id — email the project report â”€â”€â”€â”€â”€â”€â”€
router.post('/send-project-report/:id', async (req, res) => {
  const projects    = load('projects.json', []);
  const p           = projects.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const appSettings = load('app-settings.json', {});
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });
  const perType  = (appSettings.projectReportRecipients || []).filter(Boolean);
  const global   = [appSettings.ceoEmail, appSettings.cpoEmail, ...(appSettings.reportRecipients||[])].filter(Boolean);
  const toList   = perType.length ? perType : global;
  if (!toList.length) return res.status(400).json({ error: 'No recipients — add them in Settings → Reports & Emails → Project Reports' });
  try {
    const today = dubaiDateStr();
    await mailer.sendMail({ to: toList.join(','), subject: `Project Report: ${p.name} — ${today}`, html: buildProjectReportHTML(p) });
    res.json({ message: `Report sent to ${toList.join(', ')}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ GET /api/reports/daily-briefing-preview — CFO daily briefing email â”€â”€â”€â”€â”€â”€â”€â”€
const dailyBriefingPreviewHandler = (req, res) => {
  const d = getData();
  const tasks = load('tasks.json', seed().tasks);
  const ar    = load('ar.json', seed().accountReceivables);
  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});

  const overdueTasks = tasks.filter(t=>!t.done&&t.deadline&&new Date(t.deadline+'T00:00:00')<dubaiNow());
  const todayTasks   = tasks.filter(t=>!t.done&&t.deadline&&new Date(t.deadline+'T00:00:00').toDateString()===dubaiNow().toDateString());
  const upcomingTasks = tasks.filter(t=>!t.done&&t.deadline).sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)).slice(0,5);
  const overdueAR    = ar.filter(x=>x.status==='overdue').sort((a,b)=>b.amount-a.amount).slice(0,5);
  const pendingAR    = ar.filter(x=>x.status==='pending').sort((a,b)=>b.amount-a.amount).slice(0,5);

  const runway = (() => { const burn = d.budget.reduce((a,b)=>{const m=Object.keys(b.months||{}).slice(-1)[0]; return a+(b.months?.[m]?.actual||0);},0); return burn?Math.round(d.available/burn):0; })();

  const tips = [];
  if(d.overdueAR>0) tips.push(`Collect ${fmt(d.overdueAR)} in overdue AR — prioritize ${overdueAR[0]?.client||'top clients'}`);
  if(d.margin<20) tips.push(`Gross margin at ${d.margin}% — review variable costs to close the gap to 20%`);
  if(runway<6&&runway>0) tips.push(`Cash runway ~${runway} months — review burn rate and consider revenue acceleration`);
  if(d.pipeWtd>0) tips.push(`${fmt(d.pipeWtd)} in weighted pipeline — push top deals in Proposal/Negotiation to close this week`);
  if(overdueTasks.length>0) tips.push(`${overdueTasks.length} overdue task${overdueTasks.length>1?'s':''} — address immediately: "${overdueTasks[0].title}"`);
  if(tips.length===0) tips.push('All key metrics are healthy — keep executing!');

  const motivations = [
    { quote: 'Revenue is vanity, profit is sanity, cash is king.', author: 'Business Wisdom' },
    { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { quote: 'Vision without execution is just hallucination.', author: 'Thomas Edison' },
    { quote: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh' },
    { quote: 'Move fast and build things that last.', author: 'CFO Genie' },
  ];
  const motivation = motivations[Math.floor(Math.random() * motivations.length)];

  const statusBadge = (s,c,bg) => `<span style="background:${bg};color:${c};font-size:10px;font-weight:700;padding:2px 8px;border-radius:12px;text-transform:capitalize">${s}</span>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CFO Daily Briefing</title></head>
<body style="margin:0;padding:0;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#24292E">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF0F5;padding:24px 0">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);border-radius:14px 14px 0 0;padding:28px 36px">
    <div style="display:inline-block;width:44px;height:44px;background:rgba(255,255,255,.25);border-radius:12px;text-align:center;line-height:44px;font-weight:800;font-size:20px;color:#fff;margin-right:12px;vertical-align:middle">G</div>
    <span style="font-size:20px;font-weight:800;color:#fff;vertical-align:middle">CFO Daily Briefing</span>
    <div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,.8)">${dateStr}</div>
  </td></tr>

  <!-- Key Metrics -->
  <tr><td style="background:#fff;padding:24px 36px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#97A0AF;margin-bottom:14px">ðŸ’° Financial Snapshot</div>
    <table width="100%" cellpadding="0" cellspacing="6"><tr>
      <td width="22%" style="background:#F0FDF4;border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Available Cash</div><div style="font-size:16px;font-weight:800;color:#16A34A">${fmt(d.available)}</div></td>
      <td width="3%"></td>
      <td width="22%" style="background:#F4F6FA;border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">YTD Revenue</div><div style="font-size:16px;font-weight:800">${fmt(d.ytdRev)}</div></td>
      <td width="3%"></td>
      <td width="22%" style="background:#F4F6FA;border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">AR Outstanding</div><div style="font-size:16px;font-weight:800;color:${d.overdueAR>0?'#DC2626':'#24292E'}">${fmt(d.totalAR)}</div></td>
      <td width="3%"></td>
      <td width="22%" style="background:#F4F6FA;border-radius:8px;padding:12px;text-align:center"><div style="font-size:9px;color:#97A0AF;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Pipeline Wtd</div><div style="font-size:16px;font-weight:800;color:#2563EB">${fmt(d.pipeWtd)}</div></td>
    </tr></table>
  </td></tr>

  <!-- AI Tips -->
  <tr><td style="background:#FFF7F5;padding:20px 36px;border-top:1px solid #FFE4D0">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#FF681A;margin-bottom:12px"> Ayla's Daily Tips</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#24292E;line-height:1.6;padding:8px 12px;background:#fff;border-radius:8px;border-left:3px solid #FF681A;margin-bottom:8px">${t}</div>`).join('')}
  </td></tr>

  ${upcomingTasks.length?`<!-- Tasks -->
  <tr><td style="background:#fff;padding:20px 36px;border-top:1px solid #E4E7EC">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#97A0AF;margin-bottom:12px"> Upcoming Tasks</div>
    ${upcomingTasks.map(t=>{
      const isOvd=t.deadline&&new Date(t.deadline+'T00:00:00')<dubaiNow();
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid #E4E7EC;font-size:12px">
        <span style="${isOvd?'color:#DC2626;font-weight:700':''}">${isOvd?'[!] ':''} ${t.title}</span>
        <span style="font-size:10px;color:#97A0AF;white-space:nowrap;margin-left:10px">${t.deadline||'—'} · ${(t.priority||'medium')} priority</span>
      </div>`;
    }).join('')}
  </td></tr>`:''}

  ${overdueAR.length?`<!-- Overdue AR -->
  <tr><td style="background:#FEF2F2;padding:20px 36px;border-top:1px solid #FCA5A5">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#DC2626;margin-bottom:12px"> Overdue AR — Action Required</div>
    ${overdueAR.map(x=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid #FCA5A5;font-size:12px">
      <span style="font-weight:600">${x.client}</span>
      <span style="font-size:10px;color:#DC2626;font-weight:700">${fmt(x.amount)} — Due ${x.dueDate||'—'}</span>
    </div>`).join('')}
  </td></tr>`:''}

  <!-- Quote -->
  <tr><td style="background:#FFF7F5;padding:18px 36px;border-top:1px solid #FFE4D0">
    <div style="font-size:13px;font-style:italic;color:#5E6C84;line-height:1.6">"${motivation.quote}"</div>
    <div style="font-size:11px;color:#97A0AF;margin-top:5px;font-weight:600">— ${motivation.author}</div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F4F6FA;padding:14px 36px;border-radius:0 0 14px 14px;text-align:center">
    <p style="font-size:10px;color:#C7CFDB;margin:0">CFO Genie · Daily Briefing · ${new Date().getFullYear()} ${res.locals?.preview?'· <em>Preview Mode</em>':''}</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
  res.set('Content-Type','text/html').send(html);
};
router.get('/daily-briefing-preview', dailyBriefingPreviewHandler);

// â”€â”€ POST /api/reports/send-daily-briefing — send daily CFO briefing email â”€â”€â”€â”€â”€
router.post('/send-daily-briefing', async (req, res) => {
  const appSettings = load('app-settings.json', {});
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured — connect Gmail in Settings or set SMTP credentials in .env' });
  const perType    = (appSettings.dailyBriefingRecipients || []).filter(Boolean);
  const globalList = [appSettings.ceoEmail, ...(appSettings.reportRecipients||[])].filter(Boolean);
  const toList     = perType.length ? perType : globalList;
  if (!toList.length) return res.status(400).json({ error: 'Set CEO email in Reports → Notification Recipients' });
  let html = '';
  const capRes = { locals:{}, set(){ return this; }, send(h){ html=h; } };
  dailyBriefingPreviewHandler(req, capRes);
  try {
    const today = dubaiDateStr();
    await mailer.sendMail({ to: toList.join(','), subject: `CFO Daily Briefing — ${today}`, html });
    _appendEmailLog('Daily Briefing', toList.join(', '), 'sent', `Daily briefing sent to ${toList.join(', ')}`);
    res.json({ ok: true, message: `Daily briefing sent to ${toList.join(', ')}` });
  } catch(e) {
    _appendEmailLog('Daily Briefing', toList.join(', '), 'failed', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ GET /api/reports/task-reminder-preview — HTML preview of task reminder email
const taskReminderPreviewHandler = (req, res) => {
  const tasks = load('tasks.json', seed().tasks);
  const sampleTasks = tasks.filter(t => (t.taskType==='ceo'||t.taskType==='cpo') && !t.done).slice(0, 3);
  if (!sampleTasks.length) {
    // Show a dummy task for preview
    sampleTasks.push({ id:0, title:'Review Q2 Cash Position', taskType:'ceo', priority:'high', deadline: new Date(Date.now()+7*864e5).toISOString().split('T')[0], ceoNote:'Please review the cash runway and prepare a 3-scenario analysis.', remindDays:3, completionToken:'preview' });
  }
  const motivations = [
    { quote: 'Revenue is vanity, profit is sanity, cash is king.', author: 'Business Wisdom' },
    { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { quote: 'Vision without execution is just hallucination.', author: 'Thomas Edison' },
  ];
  const motivation = motivations[Math.floor(Math.random() * motivations.length)];
  const priorityColor = p => ({ high:'#DC2626', medium:'#D97706', low:'#16A34A' }[p] || '#5E6C84');
  const priorityBg    = p => ({ high:'#FEF2F2', medium:'#FFFBEB', low:'#F0FDF4' }[p] || '#F4F6FA');
  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});

  const taskCards = sampleTasks.map(task => {
    const roleLabel = task.taskType==='cpo' ? 'CPO' : 'CEO';
    const isOverdue = task.deadline && new Date(task.deadline+'T00:00:00') < dubaiNow();
    return `<div style="border:1.5px solid ${isOverdue?'#FCA5A5':'#E4E7EC'};border-radius:12px;overflow:hidden;margin-bottom:14px">
      <div style="padding:18px 20px;background:${isOverdue?'#FEF2F2':'#FAFBFC'}">
        <div style="font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">${roleLabel} Task ${isOverdue?'! OVERDUE':''}</div>
        <div style="font-size:16px;font-weight:800;color:#24292E;margin-bottom:10px">${task.title}</div>
        <span style="background:${priorityBg(task.priority)};color:${priorityColor(task.priority)};font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:capitalize">${task.priority||'normal'} priority</span>
        ${task.deadline?`<span style="float:right;font-size:12px;font-weight:600;color:${isOverdue?'#DC2626':'#5E6C84'}">ðŸ“… ${task.deadline}</span>`:''}
      </div>
      ${task.ceoNote?`<div style="padding:14px 20px;border-top:1px solid #E4E7EC"><div style="font-size:11px;color:#5E6C84;line-height:1.6">${task.ceoNote}</div></div>`:''}
      <div style="padding:10px 20px;background:#F4F6FA;border-top:1px solid #E4E7EC">
        <span style="font-size:10px;color:#97A0AF">Reminder every ${task.remindDays||3} days</span>
        <a href="#" style="float:right;font-size:10px;color:#FF681A;font-weight:700;text-decoration:none">âœ“ Mark Done →</a>
      </div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Task Reminder Preview</title></head>
<body style="margin:0;padding:0;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF0F5;padding:30px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);border-radius:14px 14px 0 0;padding:28px 32px">
    <div style="display:inline-block;width:40px;height:40px;background:rgba(255,255,255,.25);border-radius:10px;text-align:center;line-height:40px;font-weight:800;font-size:17px;color:#fff;margin-right:10px;vertical-align:middle">G</div>
    <span style="font-size:18px;font-weight:800;color:#fff;vertical-align:middle">CFO Genie</span>
    <div style="float:right;font-size:11px;color:rgba(255,255,255,.8);margin-top:6px">${dateStr}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:28px 32px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#97A0AF;margin-bottom:16px">Pending Tasks</div>
    ${taskCards}
  </td></tr>
  <tr><td style="background:#FFF7F5;padding:18px 32px;border-top:1px solid #FFE4D0">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#FF681A;margin-bottom:8px">Today's Thought</div>
    <div style="font-size:13px;font-style:italic;color:#5E6C84">"${motivation.quote}"</div>
    <div style="font-size:11px;color:#97A0AF;margin-top:5px">— ${motivation.author}</div>
  </td></tr>
  <tr><td style="background:#F4F6FA;padding:14px 32px;border-radius:0 0 14px 14px;text-align:center">
    <p style="font-size:10px;color:#C7CFDB;margin:0">CFO Genie · Task Reminder System · ${new Date().getFullYear()} &nbsp;·&nbsp; <em>Preview Mode</em></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  res.set('Content-Type','text/html').send(html);
};
router.get('/task-reminder-preview', taskReminderPreviewHandler);

// â”€â”€ GET /api/reports/validate — cross-source data consistency checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function runValidation() {
  const fmtV   = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v||0);
  const diffPct = (a,b) => (Math.max(a,b) ? ((Math.abs(a-b)/Math.max(a,b))*100) : 0);

  const ar          = load('ar.json',          seed().accountReceivables);
  const revenue     = load('revenue.json',      seed().revenue);
  const pipeline    = load('pipeline.json',     seed().pipeline);
  const clients     = load('clients.json',      seed().clients);
  const cashflow    = load('cashflow.json',     seed().cashflow);
  const budget      = load('budget.json',       seed().budget);
  const liabilities = load('liabilities.json',  seed().liabilities);
  const commissions = load('commissions.json',  []);
  const projects    = load('projects.json',     []);
  const banks       = load('cash.json',         seed().banks);
  const reserves    = load('reserves.json',     seed().reserves);

  const today       = dubaiDateStr();
  const checks      = [];

  // â”€â”€ 1. AR Paid Total vs Revenue Total â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const arPaid      = ar.filter(x => x.status === 'paid');
  const arPaidTotal = arPaid.reduce((s,x) => s + (x.amount||0), 0);
  const revTotal    = revenue.reduce((s,r) => s + (r.revenue||0), 0);
  const revDiff     = diffPct(arPaidTotal, revTotal);
  if (arPaidTotal > 0 || revTotal > 0) {
    const _s1 = revDiff < 5 ? 'pass' : revDiff < 20 ? 'warning' : 'fail';
    checks.push({
      id: 'ar_revenue_total', category: 'Revenue',
      title: 'AR Paid Invoices vs Revenue Total',
      status: _s1,
      severity: _s1 === 'fail' ? 'critical' : _s1 === 'warning' ? 'high' : 'info',
      source: fmtV(arPaidTotal), expected: fmtV(revTotal),
      delta: fmtV(arPaidTotal - revTotal), deltaPct: revDiff.toFixed(1),
      message: revDiff < 5
        ? `AR paid invoices (${fmtV(arPaidTotal)}) align with revenue records (${fmtV(revTotal)}).`
        : `AR paid invoices (${fmtV(arPaidTotal)}) differ from revenue entries (${fmtV(revTotal)}) by ${fmtV(Math.abs(arPaidTotal-revTotal))} (${revDiff.toFixed(1)}%). Revenue entries may need reconciling.`,
      aylaFix: _s1 === 'fail'
        ? `Critical mismatch. Open Statements → Reconciliation tab to identify which months have the largest gaps. Run Backfill Links to re-sync client IDs, then manually reconcile any remaining difference in the Revenue module.`
        : _s1 === 'warning'
        ? `Reconcile revenue entries with paid AR invoices. Export both lists and compare client-by-client. Small timing differences (cutoff dates) are normal; investigate gaps above 20%.`
        : null,
    });
  }

  // â”€â”€ 2. SaaS / Enterprise Revenue Breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const saasAR    = ar.filter(x => x.revenueType === 'Enterprise' && x.status === 'paid').reduce((s,x) => s+(x.amount||0), 0);
  const svcAR     = ar.filter(x => x.revenueType && x.revenueType !== 'Enterprise' && x.status === 'paid').reduce((s,x) => s+(x.amount||0), 0);
  const saasRatio = arPaidTotal ? Math.round((saasAR/arPaidTotal)*100) : 0;
  checks.push({
    id: 'saas_breakdown', category: 'SaaS',
    title: 'SaaS / Enterprise vs Services Revenue Split',
    status: 'info', severity: 'info',
    source: fmtV(saasAR), expected: fmtV(svcAR),
    delta: `${saasRatio}%`, deltaPct: saasRatio,
    message: `Enterprise/SaaS: ${fmtV(saasAR)} (${saasRatio}%) · Other services: ${fmtV(svcAR)} (${100-saasRatio}%) of paid AR (${fmtV(arPaidTotal)} total).`,
    aylaFix: null,
  });

  // â”€â”€ 3. Overdue Invoice Status Accuracy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const shouldBeOverdue = ar.filter(x => x.status === 'pending' && x.dueDate && x.dueDate < today);
  const _s3 = shouldBeOverdue.length === 0 ? 'pass' : 'warning';
  checks.push({
    id: 'ar_overdue_accuracy', category: 'AR',
    title: 'Overdue Invoice Status Accuracy',
    status: _s3, severity: _s3 === 'warning' ? 'medium' : 'info',
    source: String(ar.filter(x=>x.status==='overdue').length), expected: String(ar.filter(x=>x.status==='overdue').length + shouldBeOverdue.length),
    delta: String(shouldBeOverdue.length), deltaPct: shouldBeOverdue.length,
    message: shouldBeOverdue.length === 0
      ? 'All invoices have correct overdue status.'
      : `${shouldBeOverdue.length} invoice(s) are past their due date but still marked "pending": ${shouldBeOverdue.map(x=>`${x.client} (${x.dueDate})`).join(', ')}.`,
    items: shouldBeOverdue.map(x=>({ label: `${x.client} — ${x.invoiceNo||'no inv#'}`, detail: `Due ${x.dueDate} · ${fmtV(x.amount)}` })),
    aylaFix: _s3 === 'warning' ? `Open each listed invoice in the AR module and update its status to "Overdue". This ensures the dashboard overdue total and collection reports are accurate.` : null,
  });

  // â”€â”€ 4. Closed Won Pipeline → AR Coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const closedWon     = pipeline.filter(x => x.stage === 'Closed Won');
  const arClients     = new Set(ar.map(x => x.client?.toLowerCase().trim()));
  const wonNoAR       = closedWon.filter(d => !arClients.has(d.client?.toLowerCase().trim()));
  const wonCovPct     = closedWon.length ? ((closedWon.length-wonNoAR.length)/closedWon.length*100) : 100;
  const _s4 = wonNoAR.length === 0 ? 'pass' : wonNoAR.length <= 2 ? 'warning' : 'fail';
  checks.push({
    id: 'pipeline_ar_coverage', category: 'Pipeline',
    title: 'Closed Won Deals — AR Invoice Coverage',
    status: _s4, severity: _s4 === 'fail' ? 'high' : _s4 === 'warning' ? 'medium' : 'info',
    source: String(closedWon.length - wonNoAR.length), expected: String(closedWon.length),
    delta: String(wonNoAR.length), deltaPct: (100-wonCovPct).toFixed(1),
    message: wonNoAR.length === 0
      ? `All ${closedWon.length} Closed Won deal clients have matching AR invoices.`
      : `${wonNoAR.length} of ${closedWon.length} Closed Won clients have no AR invoice: ${wonNoAR.map(d=>d.name).join(', ')}.`,
    items: wonNoAR.map(d=>({ label: d.name, detail: `${d.client} · ${fmtV(d.value)} · Closed ${d.closeDate||'?'}` })),
    aylaFix: _s4 !== 'pass' ? `Go to the AR module and create invoices for each listed Closed Won client. If the deal is still in negotiation, update the Pipeline stage to reflect the correct status. Missing invoices delay collections.` : null,
  });

  // â”€â”€ 5. AR Client Orphans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const clientNames = new Set(clients.map(c => c.name?.toLowerCase().trim()));
  const orphanAR    = ar.filter(x => x.client && !clientNames.has(x.client?.toLowerCase().trim()));
  const _s5 = orphanAR.length === 0 ? 'pass' : orphanAR.length <= 2 ? 'warning' : 'fail';
  checks.push({
    id: 'ar_client_orphans', category: 'AR',
    title: 'AR Invoices — Client List Coverage',
    status: _s5, severity: _s5 === 'fail' ? 'high' : _s5 === 'warning' ? 'medium' : 'info',
    source: String(ar.length - orphanAR.length), expected: String(ar.length),
    delta: String(orphanAR.length), deltaPct: ar.length ? (orphanAR.length/ar.length*100).toFixed(1) : 0,
    message: orphanAR.length === 0
      ? `All ${ar.length} AR invoices reference clients in your client list.`
      : `${orphanAR.length} invoice(s) reference unknown clients: ${[...new Set(orphanAR.map(x=>x.client))].join(', ')}.`,
    items: orphanAR.map(x=>({ label: `${x.client} — ${x.invoiceNo||'no #'}`, detail: fmtV(x.amount) })),
    aylaFix: _s5 !== 'pass' ? `Fix the client name spelling in the AR module to exactly match the name in the Clients module, or add missing clients in the Clients module. Then run Backfill Links to re-link orphaned invoices.` : null,
  });

  // â”€â”€ 6. Budget vs Actual Revenue Attainment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const budgetTotal = budget.reduce((s,r) => s + (r.target||r.budget||0), 0);
  if (budgetTotal > 0) {
    const att = revTotal ? Math.round((revTotal/budgetTotal)*100) : 0;
    const _s6 = att >= 90 ? 'pass' : att >= 70 ? 'warning' : 'fail';
    checks.push({
      id: 'budget_vs_actual', category: 'Budget',
      title: 'Revenue vs Budget Target Attainment',
      status: _s6, severity: _s6 === 'fail' ? 'critical' : _s6 === 'warning' ? 'high' : 'info',
      source: fmtV(revTotal), expected: fmtV(budgetTotal),
      delta: fmtV(revTotal-budgetTotal), deltaPct: att,
      message: `Revenue ${fmtV(revTotal)} is ${att}% of budget target ${fmtV(budgetTotal)}. ${att>=100?'Target exceeded!':att>=90?'On track.':att>=70?'Approaching — monitor closely.':'Significantly below target.'}`,
      aylaFix: _s6 === 'fail'
        ? `Revenue is significantly below target. Verify all revenue streams are entered in the Revenue module. Review the pipeline for near-close deals that could close this gap, and check whether budget targets need revision based on current business conditions.`
        : _s6 === 'warning'
        ? `Monitor revenue closely. Identify which categories are underperforming in the Budget module. Consider accelerating pipeline deals or revising targets if market conditions have shifted.`
        : null,
    });
  }

  // â”€â”€ 7. Cash Flow Inflows vs AR Paid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const cfInflow   = cashflow.reduce((s,r) => s + (r.inflow||0), 0);
  if (cfInflow > 0 && arPaidTotal > 0) {
    const cfDiff = diffPct(cfInflow, arPaidTotal);
    const _s7 = cfDiff < 10 ? 'pass' : cfDiff < 30 ? 'warning' : 'fail';
    checks.push({
      id: 'cashflow_ar_alignment', category: 'Cash Flow',
      title: 'Cash Flow Inflows vs AR Paid Total',
      status: _s7, severity: _s7 === 'fail' ? 'high' : _s7 === 'warning' ? 'medium' : 'info',
      source: fmtV(cfInflow), expected: fmtV(arPaidTotal),
      delta: fmtV(cfInflow - arPaidTotal), deltaPct: cfDiff.toFixed(1),
      message: cfDiff < 10
        ? `Cash flow inflows (${fmtV(cfInflow)}) are consistent with AR paid total (${fmtV(arPaidTotal)}).`
        : `Cash flow inflows (${fmtV(cfInflow)}) differ from AR paid (${fmtV(arPaidTotal)}) by ${cfDiff.toFixed(1)}%. Verify non-AR income items.`,
      aylaFix: _s7 !== 'pass' ? `Review Cash Flow entries for non-AR income sources (grants, investments, loans, transfers). Ensure all inflows are logged with the correct category. A large gap may also indicate duplicate AR entries or missing cash flow rows.` : null,
    });
  }

  // â”€â”€ 8. Liabilities vs Available Cash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const totalLiab = liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
  const totalCash = banks.reduce((s,b)=>s+(b.total||0),0);
  const reserved  = reserves.reduce((s,r)=>s+(r.amount||0),0);
  const available = totalCash - reserved;
  if (totalLiab > 0 && available > 0) {
    const ratio = Math.round((totalLiab/available)*100);
    const _s8 = ratio <= 80 ? 'pass' : ratio <= 120 ? 'warning' : 'fail';
    checks.push({
      id: 'liabilities_cash_ratio', category: 'Liabilities',
      title: 'Liabilities-to-Available-Cash Ratio',
      status: _s8, severity: _s8 === 'fail' ? 'critical' : _s8 === 'warning' ? 'high' : 'info',
      source: fmtV(totalLiab), expected: fmtV(available),
      delta: `${ratio}%`, deltaPct: ratio,
      message: `Liabilities (${fmtV(totalLiab)}) = ${ratio}% of available cash (${fmtV(available)}). ${ratio<=80?'Healthy.':ratio<=120?'Elevated — monitor reserves.':'Liabilities exceed available cash.'}`,
      aylaFix: _s8 === 'fail'
        ? `Liabilities exceed available cash — review the Liabilities module for items due within 30 days and prioritize payment scheduling. Consider reducing reserve allocations temporarily or accelerating AR collections to improve liquidity.`
        : _s8 === 'warning'
        ? `Liabilities are elevated. Review upcoming due dates in the Liabilities module and ensure cash reserves are sized appropriately. Monitor this ratio weekly until it returns below 80%.`
        : null,
    });
  }

  // â”€â”€ 9. Commission Entries vs Pipeline Deals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (commissions.length > 0) {
    const noMatch = commissions.filter(c => c.dealName && !pipeline.find(d=>d.name?.toLowerCase()===c.dealName?.toLowerCase()));
    const _s9 = noMatch.length === 0 ? 'pass' : 'warning';
    checks.push({
      id: 'commission_pipeline', category: 'Commissions',
      title: 'Commission Records — Pipeline Match',
      status: _s9, severity: _s9 === 'warning' ? 'medium' : 'info',
      source: String(commissions.length - noMatch.length), expected: String(commissions.length),
      delta: String(noMatch.length), deltaPct: (noMatch.length/commissions.length*100).toFixed(1),
      message: noMatch.length === 0
        ? `All ${commissions.length} commission entries match pipeline deals.`
        : `${noMatch.length} commission(s) have no pipeline deal match: ${noMatch.map(c=>c.dealName||c.repName).join(', ')}.`,
      items: noMatch.map(c=>({ label: c.dealName||'(unnamed)', detail: `${c.repName} · ${fmtV(c.amount)}` })),
      aylaFix: _s9 === 'warning' ? `In the Commissions module, update the deal name on each affected entry to exactly match the Pipeline deal name (case-insensitive). Then run Backfill Links to restore the deal ID link.` : null,
    });
  }

  // â”€â”€ 10. Project Budget Overruns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (projects.length > 0) {
    const overBudget = projects.filter(p => {
      const spent = (p.expenses||[]).reduce((s,e)=>s+(e.amount||0),0);
      return p.budget > 0 && spent > p.budget;
    });
    const _s10 = overBudget.length === 0 ? 'pass' : overBudget.length <= 2 ? 'warning' : 'fail';
    checks.push({
      id: 'project_budget_overrun', category: 'Projects',
      title: 'Project Budget Compliance',
      status: _s10, severity: _s10 === 'fail' ? 'high' : _s10 === 'warning' ? 'medium' : 'info',
      source: String(projects.length - overBudget.length), expected: String(projects.length),
      delta: String(overBudget.length), deltaPct: (overBudget.length/projects.length*100).toFixed(1),
      message: overBudget.length === 0
        ? `All ${projects.length} projects are within budget.`
        : `${overBudget.length} project(s) exceeded budget: ${overBudget.map(p=>p.name).join(', ')}.`,
      items: overBudget.map(p=>{
        const spent=(p.expenses||[]).reduce((s,e)=>s+(e.amount||0),0);
        return { label: p.name, detail: `Budget ${fmtV(p.budget)} · Spent ${fmtV(spent)} · Over by ${fmtV(spent-p.budget)}` };
      }),
      aylaFix: _s10 !== 'pass' ? `Review expense entries in the Projects module for each listed project. Verify all expenses are correctly categorized and not duplicated. If scope has expanded, update the project budget to reflect approved changes.` : null,
    });
  }

  // â”€â”€ 11. Pipeline Probability Anomalies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const probAnomalies = pipeline.filter(d =>
    (d.stage === 'Closed Won'  && d.probability < 100) ||
    (d.stage === 'Closed Lost' && d.probability > 0)   ||
    (d.probability > 100 || d.probability < 0)
  );
  if (pipeline.length > 0) {
    const _s11 = probAnomalies.length === 0 ? 'pass' : 'warning';
    checks.push({
      id: 'pipeline_probability', category: 'Pipeline',
      title: 'Pipeline Stage vs Probability Consistency',
      status: _s11, severity: _s11 === 'warning' ? 'medium' : 'info',
      source: String(pipeline.length - probAnomalies.length), expected: String(pipeline.length),
      delta: String(probAnomalies.length), deltaPct: (probAnomalies.length/pipeline.length*100).toFixed(1),
      message: probAnomalies.length === 0
        ? `All ${pipeline.length} pipeline deals have consistent stage/probability values.`
        : `${probAnomalies.length} deal(s) have mismatched stage/probability: ${probAnomalies.map(d=>`${d.name} (${d.stage} @ ${d.probability}%)`).join(', ')}.`,
      items: probAnomalies.map(d=>({ label: d.name, detail: `${d.stage} · ${d.probability}% probability` })),
      aylaFix: _s11 === 'warning' ? `In the Pipeline module, update each listed deal's probability: Closed Won should be 100%, Closed Lost should be 0%. Incorrect probabilities skew the weighted pipeline forecast shown on the dashboard.` : null,
    });
  }

  // â”€â”€ 12. Dashboard KPI Cross-Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dashTotalAR  = ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+(x.amount||0),0);
  const dashOverdue  = ar.filter(x=>x.status==='overdue').reduce((s,x)=>s+(x.amount||0),0);
  const dashPipeWtd  = pipeline.reduce((s,d)=>s+d.value*(d.probability/100),0);
  checks.push({
    id: 'dashboard_kpi_check', category: 'Dashboard',
    title: 'Dashboard KPI Snapshot',
    status: 'info', severity: 'info',
    source: fmtV(totalCash), expected: fmtV(available),
    delta: fmtV(reserved), deltaPct: reserved,
    message: `Cash: ${fmtV(totalCash)} total · ${fmtV(available)} available · ${fmtV(reserved)} reserved. ` +
             `AR outstanding: ${fmtV(dashTotalAR)} (${fmtV(dashOverdue)} overdue). ` +
             `Pipeline weighted: ${fmtV(dashPipeWtd)}.`,
    aylaFix: null,
  });

  // â”€â”€ 13. AR Missing Revenue Type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const arNoType = ar.filter(x => !x.revenueType || x.revenueType === '');
  if (ar.length > 0) {
    const _s13 = arNoType.length === 0 ? 'pass' : arNoType.length <= 3 ? 'warning' : 'fail';
    checks.push({
      id: 'ar_missing_revenue_type', category: 'AR',
      title: 'AR Invoices — Revenue Type Coverage',
      status: _s13, severity: _s13 === 'fail' ? 'high' : _s13 === 'warning' ? 'medium' : 'info',
      source: String(ar.length - arNoType.length), expected: String(ar.length),
      delta: String(arNoType.length), deltaPct: ar.length ? (arNoType.length/ar.length*100).toFixed(1) : 0,
      message: arNoType.length === 0
        ? `All ${ar.length} AR invoices have a revenue type set.`
        : `${arNoType.length} invoice(s) have no revenue type (Enterprise/SaaS/Services/â€¦): ${arNoType.map(x=>x.client||x.invoice||'—').slice(0,5).join(', ')}${arNoType.length>5?'â€¦':''}.`,
      items: arNoType.map(x => ({ label: `${x.client} — ${x.invoice||'no #'}`, detail: fmtV(x.amount) })),
      aylaFix: _s13 !== 'pass' ? `Open each listed invoice in the AR module and set a Revenue Type (Enterprise, SaaS, Services, Retainer, etc.). Revenue type is required for the SaaS/Enterprise breakdown check and for P&L category mapping in reports.` : null,
    });
  }

  // â”€â”€ 14. AR Missing Client Link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const arNoClientId = ar.filter(x => !x.clientId);
  if (ar.length > 0) {
    const _s14 = arNoClientId.length === 0 ? 'pass' : arNoClientId.length <= 3 ? 'warning' : 'fail';
    checks.push({
      id: 'ar_missing_client_id', category: 'AR',
      title: 'AR Invoices — Client ID Link',
      status: _s14, severity: _s14 === 'fail' ? 'high' : _s14 === 'warning' ? 'high' : 'info',
      source: String(ar.length - arNoClientId.length), expected: String(ar.length),
      delta: String(arNoClientId.length), deltaPct: ar.length ? (arNoClientId.length/ar.length*100).toFixed(1) : 0,
      message: arNoClientId.length === 0
        ? `All ${ar.length} AR invoices are linked to a client record.`
        : `${arNoClientId.length} invoice(s) have no client ID link — client name may be misspelled or client not in list: ${[...new Set(arNoClientId.map(x=>x.client||'(blank)'))].slice(0,5).join(', ')}.`,
      items: arNoClientId.map(x => ({ label: `${x.client||'(blank)'} — ${x.invoice||'no #'}`, detail: fmtV(x.amount) })),
      aylaFix: _s14 !== 'pass' ? `Click "Backfill Links" to auto-match invoices to clients by name. For remaining unlinked invoices, ensure the client name in AR exactly matches the name in the Clients module, or use the AR unlinked panel (AR module) to fix records individually.` : null,
    });
  }

  // â”€â”€ 15. Commission Missing Deal Link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const commNoDealId = commissions.filter(c => c.dealName && !c.dealId);
  if (commissions.length > 0) {
    const _s15 = commNoDealId.length === 0 ? 'pass' : 'warning';
    checks.push({
      id: 'commission_no_deal_id', category: 'Commissions',
      title: 'Commission Records — Pipeline Deal Link',
      status: _s15, severity: _s15 === 'warning' ? 'medium' : 'info',
      source: String(commissions.length - commNoDealId.length), expected: String(commissions.length),
      delta: String(commNoDealId.length), deltaPct: (commNoDealId.length/commissions.length*100).toFixed(1),
      message: commNoDealId.length === 0
        ? `All commissions with a deal name are linked to a pipeline deal.`
        : `${commNoDealId.length} commission(s) have a deal name but no matching pipeline deal: ${commNoDealId.map(c=>c.dealName).slice(0,5).join(', ')}.`,
      items: commNoDealId.map(c => ({ label: c.dealName||'(unnamed)', detail: `${c.repName} · ${fmtV(c.amount)}` })),
      aylaFix: _s15 === 'warning' ? `Run Backfill Links to auto-match commission deal names to pipeline deal IDs. If the deal name in Commissions doesn't exactly match the Pipeline deal name, edit one to align them, then re-run Backfill Links.` : null,
    });
  }

  const pass    = checks.filter(c=>c.status==='pass').length;
  const warning = checks.filter(c=>c.status==='warning').length;
  const fail    = checks.filter(c=>c.status==='fail').length;
  const info    = checks.filter(c=>c.status==='info').length;

  return {
    runAt: new Date().toISOString(),
    summary: { total: checks.length, pass, warning, fail, info },
    checks
  };
}

router.get('/validate', (req, res) => {
  try {
    const result = runValidation();
    const cfg = load('app-settings.json', {});
    const hist = cfg.validationHistory || [];
    const summary = {
      ts: new Date().toISOString(),
      pass:     result.summary.pass,
      warn:     result.summary.warning,
      fail:     result.summary.fail,
      info:     result.summary.info,
      total:    result.summary.total,
      critical: result.checks.filter(c=>c.severity==='critical'&&c.status!=='pass').length,
    };
    hist.unshift(summary);
    if (hist.length > 90) hist.length = 90;
    save('app-settings.json', { ...cfg, validationHistory: hist });
    res.json(result);
  }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/validate/history', (req, res) => {
  const cfg = load('app-settings.json', {});
  res.json(cfg.validationHistory || []);
});

// â”€â”€ Shared helper: send reminder emails for a given role â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendReminderEmail(taskRole, toEmail, baseUrl) {
  if (!mailer.isConfigured()) throw new Error('Email not configured — connect Gmail in Settings or set SMTP credentials in .env');
  if (!toEmail) throw new Error('No recipient email');
  const tasks = load('tasks.json', seed().tasks);
  const now   = Date.now();
  const roleLabel = taskRole === 'cpo' ? 'CPO' : 'CEO';
  const pending = tasks.filter(t =>
    t.taskType === taskRole && !t.done &&
    (!t.lastReminderSent || (now - new Date(t.lastReminderSent).getTime()) > (t.remindDays||3)*24*60*60*1000)
  );
  if (!pending.length) return { sent: 0, message: `No pending ${roleLabel} reminders` };
  const motivations = [
    { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { quote: 'Don\'t watch the clock; do what it does. Keep going.', author: 'Sam Levenson' },
    { quote: 'Vision without execution is just hallucination.', author: 'Thomas Edison' },
    { quote: 'Revenue is vanity, profit is sanity, cash is king.', author: 'Business Wisdom' },
    { quote: 'It always seems impossible until it\'s done.', author: 'Nelson Mandela' },
  ];
  const motivation = motivations[Math.floor(Math.random() * motivations.length)];
  const priorityColor = p => ({ high:'#DC2626', medium:'#D97706', low:'#16A34A' }[p] || '#5E6C84');
  const priorityBg    = p => ({ high:'#FEF2F2', medium:'#FFFBEB', low:'#F0FDF4' }[p] || '#F4F6FA');
  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});
  const crypto = require('crypto');
  let sent = 0;
  for (const task of pending) {
    if (!task.completionToken) {
      task.completionToken = crypto.randomBytes(16).toString('hex');
    }
    const doneLink = `${baseUrl}/api/tasks/complete-by-token/${task.completionToken}`;
    const isOverdue = task.deadline && new Date(task.deadline+'T00:00:00') < dubaiNow();
    const overdueTag = isOverdue ? '! OVERDUE — ' : '';
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Task Reminder</title></head>
<body style="margin:0;padding:0;background:#EDF0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDF0F5;padding:30px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="background:linear-gradient(135deg,${isOverdue?'#DC2626 0%,#EF4444':'#FF681A 0%,#FF8C4A'} 100%);border-radius:14px 14px 0 0;padding:28px 32px">
  <table width="100%"><tr><td><div style="display:inline-block;width:40px;height:40px;background:rgba(255,255,255,.25);border-radius:10px;text-align:center;line-height:40px;font-weight:800;font-size:17px;color:#fff;vertical-align:middle;margin-right:10px">G</div>
  <span style="font-size:18px;font-weight:800;color:#fff;vertical-align:middle">CFO Genie</span></td>
  <td align="right"><div style="font-size:10px;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.07em">${roleLabel} Task Reminder</div>
  <div style="font-size:11px;font-weight:600;color:#fff;margin-top:2px">${dateStr}</div></td></tr></table>
</td></tr>
<tr><td style="background:#fff;padding:28px 32px">
  <div style="border:1.5px solid ${isOverdue?'#FCA5A5':'#E4E7EC'};border-radius:12px;overflow:hidden">
    <div style="padding:18px 20px;background:${isOverdue?'#FEF2F2':'#FAFBFC'}">
      <div style="font-size:17px;font-weight:800;color:#24292E;margin-bottom:10px">${task.title}</div>
      <span style="background:${priorityBg(task.priority)};color:${priorityColor(task.priority)};font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px">${task.priority||'normal'} priority</span>
      ${task.deadline?`<span style="float:right;font-size:12px;font-weight:600;color:${isOverdue?'#DC2626':'#5E6C84'}">ðŸ“… ${task.deadline}</span>`:''}
    </div>
    ${task.ceoNote?`<div style="padding:16px 20px;border-top:1px solid #E4E7EC"><div style="font-size:13px;color:#5E6C84;line-height:1.6">${task.ceoNote}</div></div>`:''}
    <div style="padding:12px 20px;background:#F4F6FA;border-top:1px solid #E4E7EC">
      <span style="font-size:10px;color:#97A0AF">Reminder frequency: every ${task.remindDays||3} days</span>
    </div>
  </div>
</td></tr>
<tr><td style="background:#fff;padding:0 32px 28px">
  ${doneLink?`<a href="${doneLink}" style="display:inline-block;background:#16A34A;color:#fff;padding:13px 24px;border-radius:9px;text-decoration:none;font-weight:700;font-size:13px;margin-right:8px">âœ“ Mark as Done</a>`:''}
  <a href="${baseUrl}" style="display:inline-block;background:#F4F6FA;color:#24292E;padding:13px 24px;border-radius:9px;text-decoration:none;font-weight:600;font-size:13px;border:1.5px solid #E4E7EC">Open Dashboard →</a>
</td></tr>
<tr><td style="background:#FFF7F5;padding:20px 32px;border-top:1px solid #FFE4D0">
  <div style="font-size:10px;font-weight:700;color:#FF681A;margin-bottom:6px">Today's Thought</div>
  <div style="font-size:13px;font-style:italic;color:#5E6C84">"${motivation.quote}"</div>
  <div style="font-size:11px;color:#97A0AF;margin-top:5px">— ${motivation.author}</div>
</td></tr>
<tr><td style="background:#F4F6FA;padding:14px 32px;border-radius:0 0 14px 14px;text-align:center">
  <p style="font-size:10px;color:#C7CFDB;margin:0">CFO Genie · Task Reminder System · ${new Date().getFullYear()}</p>
</td></tr>
</table></td></tr></table></body></html>`;
    await mailer.sendMail({ to: toEmail, subject: `[CFO Genie] ${overdueTag}${roleLabel} Task: ${task.title}`, html });
    task.lastReminderSent = new Date().toISOString();
    sent++;
  }
  save('tasks.json', tasks);
  return { sent, message: `${sent} reminder${sent>1?'s':''} sent to ${toEmail}` };
}

// ── Scheduler-callable send helpers ──────────────────────────────────────────
async function sendPipelineDigestEmail(toList, baseUrl) {
  if (!mailer.isConfigured()) throw new Error('Email not configured');
  if (!toList.length) throw new Error('No recipients');
  const appSettings = load('app-settings.json', {});
  const staleAfter  = appSettings.pipelineStaleAfterDays || 14;
  const today       = dubaiNow();
  const staleDate   = new Date(today.getTime() - staleAfter*24*60*60*1000);
  const deals       = load('pipeline.json', seed().pipeline);
  const open        = deals.filter(d => d.stage!=='Closed Won' && d.stage!=='Closed Lost');
  const stale       = open.filter(d => !d.lastUpdated || new Date(d.lastUpdated) < staleDate);
  const followUpToday = open.filter(d => d.followUpDate === dubaiDateStr());
  const totalWtd    = open.reduce((s,d)=>s+d.value*(d.probability/100),0);
  const rows = open.sort((a,b)=>b.value-a.value).slice(0,10).map(d=>`
    <tr style="border-bottom:1px solid #E4E7EC">
      <td style="padding:8px 10px;font-size:13px;color:#24292E">${d.name}</td>
      <td style="padding:8px 10px;font-size:13px">${d.stage}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;font-weight:600">${fmt(d.value)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center">${d.probability}%</td>
      <td style="padding:8px 10px;font-size:13px">${d.owner||'-'}</td>
      <td style="padding:8px 10px;font-size:11px;color:${!d.lastUpdated||new Date(d.lastUpdated)<staleDate?'#DC2626':'#16A34A'}">${d.lastUpdated||'Never'}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#EDF0F5;padding:24px">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#FF681A,#FF8C4A);padding:24px 28px">
      <div style="font-size:12px;color:rgba(255,255,255,.8)">${today.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'})}</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-top:4px">Pipeline Digest</div>
    </div>
    <div style="padding:24px 28px">
      <div style="display:flex;gap:20px;margin-bottom:20px">
        <div style="flex:1;background:#F4F6FA;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Open Deals</div><div style="font-size:22px;font-weight:800;color:#24292E">${open.length}</div></div>
        <div style="flex:1;background:#F4F6FA;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Weighted Forecast</div><div style="font-size:22px;font-weight:800;color:#FF681A">${fmt(totalWtd)}</div></div>
        <div style="flex:1;background:${stale.length?'#FEF2F2':'#F0FDF4'};border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Stale (${staleAfter}d+)</div><div style="font-size:22px;font-weight:800;color:${stale.length?'#DC2626':'#16A34A'}">${stale.length}</div></div>
        <div style="flex:1;background:#F0FDF4;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#97A0AF">Follow-ups Today</div><div style="font-size:22px;font-weight:800;color:#16A34A">${followUpToday.length}</div></div>
      </div>
      ${followUpToday.length?`<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:6px">Follow-ups Due Today</div>${followUpToday.map(d=>`<div style="font-size:12px;color:#24292E;padding:3px 0">· <strong>${d.name}</strong> (${d.owner||'unassigned'}) &mdash; ${d.stage}</div>`).join('')}</div>`:''}
      ${stale.length?`<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px 16px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:#7F1D1D;margin-bottom:6px">Stale Deals (no update in ${staleAfter}+ days)</div>${stale.map(d=>`<div style="font-size:12px;color:#24292E;padding:3px 0">· <strong>${d.name}</strong> &mdash; ${d.stage} &middot; Owner: ${d.owner||'-'} &middot; Last: ${d.lastUpdated||'never'}</div>`).join('')}</div>`:''}
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#F4F6FA"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#97A0AF">Deal</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#97A0AF">Stage</th><th style="padding:8px 10px;text-align:right;font-size:11px;color:#97A0AF">Value</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#97A0AF">Prob</th><th style="padding:8px 10px;font-size:11px;color:#97A0AF">Owner</th><th style="padding:8px 10px;font-size:11px;color:#97A0AF">Last Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="background:#F4F6FA;padding:14px 28px;font-size:10px;color:#97A0AF;text-align:center">CFO Genie &middot; Pipeline Digest &middot; ${new Date().getFullYear()}</div>
  </div></body></html>`;
  const dateLabel = today.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'Asia/Dubai'});
  await mailer.sendMail({ to: toList.join(','), subject: `Pipeline Digest - ${open.length} open, ${fmt(totalWtd)} weighted - ${dateLabel}`, html });
  return { sent: toList.length, message: `Digest sent to ${toList.join(', ')}` };
}

async function sendDailyBriefingEmail(toList, baseUrl) {
  if (!mailer.isConfigured()) throw new Error('Email not configured');
  if (!toList.length) throw new Error('No recipients');
  let html = '';
  const capRes = { locals:{}, set(){ return this; }, send(h){ html=h; } };
  dailyBriefingPreviewHandler({}, capRes);
  const today = dubaiDateStr();
  await mailer.sendMail({ to: toList.join(','), subject: `CFO Daily Briefing - ${today}`, html });
  return { sent: toList.length, message: `Daily briefing sent to ${toList.join(', ')}` };
}

function buildStaleAlertHTML(staleDeals, staleAfter, dateStr, isPreview) {
  const fmtAmt = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
  const daysSince = d => {
    if (!d.lastUpdated) return null;
    return Math.floor((Date.now() - new Date(d.lastUpdated)) / 86400000);
  };
  const urgencyColor = d => {
    const days = daysSince(d);
    if (days === null || days > 30) return '#DC2626';
    if (days > 21) return '#D97706';
    return '#2563EB';
  };
  const stageColors = { 'Lead':'#6366F1','Qualified':'#3B82F6','Proposal Sent':'#8B5CF6','Negotiation':'#F59E0B','Closed Won':'#16A34A','Closed Lost':'#EF4444' };
  const dealRows = staleDeals.map(d => {
    const days = daysSince(d);
    const urg = urgencyColor(d);
    const sc = stageColors[d.stage] || '#64748B';
    return `
    <tr>
      <td style="padding:0 0 12px 0">
        <div style="border-radius:10px;border:1px solid ${urg}33;background:${urg}06;padding:14px 16px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
            <div style="font-size:14px;font-weight:700;color:#1E293B;line-height:1.3">${d.name}</div>
            <span style="flex-shrink:0;font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;background:${urg}18;color:${urg};white-space:nowrap">${days===null?'Never updated':days+'d stale'}</span>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:0;width:33%"><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:.06em">Stage</div><div style="font-size:11px;font-weight:600;color:${sc};margin-top:2px">${d.stage}</div></td>
              <td style="padding:0;width:33%"><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:.06em">Value</div><div style="font-size:11px;font-weight:600;color:#1E293B;margin-top:2px">${fmtAmt(d.value)}</div></td>
              <td style="padding:0;width:33%"><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:.06em">Probability</div><div style="font-size:11px;font-weight:600;color:#1E293B;margin-top:2px">${d.probability||0}%</div></td>
            </tr>
          </table>
          ${d.followUpDate ? `<div style="margin-top:8px;font-size:10px;color:#D97706;background:#FFFBEB;border-radius:5px;padding:4px 8px;display:inline-block">⚠ Follow-up was due: ${d.followUpDate}</div>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:28px 16px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<div style="max-width:580px;margin:0 auto">
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#991B1B 0%,#DC2626 50%,#EF4444 100%);padding:28px 32px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">⚠</div>
        <div>
          <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em">CFO Genie · Pipeline Alert</div>
          <div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2">Stale Deal Alert</div>
        </div>
      </div>
      <div style="background:rgba(0,0,0,.15);border-radius:8px;padding:10px 14px;display:inline-block">
        <div style="font-size:12px;color:rgba(255,255,255,.9)">${staleDeals.length} deal${staleDeals.length!==1?'s':''} with no activity for ${staleAfter}+ days</div>
        <div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px">${dateStr}${isPreview?' · Preview Mode':''}</div>
      </div>
    </div>
    <!-- Body -->
    <div style="padding:24px 32px">
      ${!staleDeals.length
        ? `<div style="text-align:center;padding:32px 0">
             <div style="font-size:36px;margin-bottom:12px">✅</div>
             <div style="font-size:15px;font-weight:700;color:#16A34A">All deals are active!</div>
             <div style="font-size:12px;color:#94A3B8;margin-top:4px">No deals have gone stale. Keep up the momentum.</div>
           </div>`
        : `<div style="margin-bottom:16px;background:#FEF2F2;border-left:3px solid #DC2626;border-radius:0 8px 8px 0;padding:12px 16px">
             <div style="font-size:12px;font-weight:700;color:#7F1D1D">Immediate action required</div>
             <div style="font-size:11px;color:#B91C1C;margin-top:3px">The deals below have had no recorded activity in ${staleAfter}+ days. Each deal owner should update status or log a follow-up.</div>
           </div>
           <table style="width:100%;border-collapse:collapse">${dealRows}</table>`}
    </div>
    <!-- Footer -->
    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:14px 32px;text-align:center">
      <div style="font-size:10px;color:#94A3B8">CFO Genie · Automated Stale Deal Alert · ${isPreview?'Preview':'Sent'} ${dateStr}</div>
    </div>
  </div>
</div>
</body></html>`;
}

async function sendStaleAlertEmail(baseUrl, appSettings) {
  if (!mailer.isConfigured()) throw new Error('Email not configured');
  const staleAfter = appSettings.pipelineStaleAfterDays || 14;
  const deals = load('pipeline.json', seed().pipeline);
  const staleDate = new Date(Date.now() - staleAfter*24*60*60*1000);
  const stale = deals.filter(d =>
    d.stage!=='Closed Won' && d.stage!=='Closed Lost' &&
    d.ownerEmail && (!d.lastUpdated || new Date(d.lastUpdated) < staleDate)
  );
  if (!stale.length) return { sent: 0, message: 'No stale deals with owner emails' };
  const byOwnerEmail = {};
  stale.forEach(d => { (byOwnerEmail[d.ownerEmail] = byOwnerEmail[d.ownerEmail]||[]).push(d); });
  const dateStr = dubaiNow().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Dubai'});
  let sent = 0;
  for (const [email, ownerDeals] of Object.entries(byOwnerEmail)) {
    const html = buildStaleAlertHTML(ownerDeals, staleAfter, dateStr, false);
    await mailer.sendMail({ to: email, subject: `⚠ ${ownerDeals.length} deal${ownerDeals.length>1?'s':''} need your attention — CFO Genie`, html });
    sent++;
  }
  return { sent, message: `Alerts sent to ${sent} deal owner${sent>1?'s':''}` };
}

module.exports = router;
module.exports.previewHandler = previewHandler;
module.exports.taskReminderPreviewHandler = taskReminderPreviewHandler;
module.exports.dailyBriefingPreviewHandler = dailyBriefingPreviewHandler;
module.exports.projectReportPreviewHandler = projectReportPreviewHandler;
module.exports.buildEmailHTML = buildEmailHTML;
module.exports.getData = getData;
module.exports.sendReminderEmail = sendReminderEmail;
module.exports.sendPipelineDigestEmail = sendPipelineDigestEmail;
module.exports.sendDailyBriefingEmail  = sendDailyBriefingEmail;
module.exports.sendStaleAlertEmail     = sendStaleAlertEmail;






