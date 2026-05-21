import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  LineChart,
  Newspaper,
  Radar,
  Scale,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import './styles.css';

const marketTiles = [
  { label: 'S&P 500', value: '5,307', move: '+0.6%', tone: 'up' },
  { label: 'Nasdaq', value: '16,801', move: '+0.9%', tone: 'up' },
  { label: '10Y Treasury', value: '4.43%', move: '-4 bps', tone: 'down' },
  { label: 'Dollar Index', value: '104.7', move: '+0.1%', tone: 'flat' },
  { label: 'WTI Crude', value: '$79.2', move: '-0.8%', tone: 'down' },
];

const headlines = [
  {
    theme: 'Rates / Fed',
    title: 'Markets keep repricing the path of cuts as inflation proves sticky.',
    signal:
      'Higher-for-longer keeps pressure on leveraged finance, sponsor exits, and long-duration growth multiples.',
    checks: ['Fed', 'Reuters', 'WSJ/FT/NYT theme check'],
  },
  {
    theme: 'AI Capex',
    title: 'Mega-cap AI spending is moving from narrative to cash-flow scrutiny.',
    signal:
      'IB angle: capex intensity reshapes software margins, data-center financing, power demand, and strategic M&A.',
    checks: ['Company filings', 'CNBC', 'FT theme check'],
  },
  {
    theme: 'Credit',
    title: 'Spreads remain constructive, but refinancing risk is still concentrated.',
    signal:
      'Banks can underwrite, but weaker borrowers face a narrower path unless rates or earnings improve.',
    checks: ['FRED', 'ICE/BofA series', 'MarketWatch'],
  },
  {
    theme: 'Consumer',
    title: 'The consumer is bifurcating: premium resilience, lower-income stress.',
    signal:
      'Second-order read-through: retail winners can keep pricing power while lenders monitor delinquencies.',
    checks: ['Earnings calls', 'BLS/BEA', 'NYT theme check'],
  },
];

const yieldCurve = [
  { tenor: '3M', yield: 5.42 },
  { tenor: '2Y', yield: 4.86 },
  { tenor: '5Y', yield: 4.47 },
  { tenor: '10Y', yield: 4.43 },
  { tenor: '30Y', yield: 4.58 },
];

const sectorPulse = [
  { sector: 'Banks', score: 71 },
  { sector: 'Software', score: 64 },
  { sector: 'Industrials', score: 58 },
  { sector: 'Consumer', score: 46 },
  { sector: 'Real Estate', score: 39 },
];

const creditData = [
  { month: 'Jan', ig: 92, hy: 352 },
  { month: 'Feb', ig: 88, hy: 338 },
  { month: 'Mar', ig: 94, hy: 361 },
  { month: 'Apr', ig: 99, hy: 378 },
  { month: 'May', ig: 91, hy: 344 },
];

const dealTimeline = [
  { step: 'Rumor', status: 'done' },
  { step: 'Strategic rationale', status: 'done' },
  { step: 'Valuation debate', status: 'active' },
  { step: 'Regulatory read', status: 'watch' },
  { step: 'Financing terms', status: 'watch' },
];

const sourceStack = [
  'Reuters, AP, CNBC, Yahoo Finance, MarketWatch',
  'FRED, BLS, BEA, Treasury, Federal Reserve, SEC filings',
  'Company press releases, earnings transcripts, investor presentations',
  'WSJ / FT / NYT used as theme validation where accessible',
];

function MetricMove({ tone }) {
  if (tone === 'up') return <ArrowUpRight size={16} />;
  if (tone === 'down') return <ArrowDownRight size={16} />;
  return <Activity size={16} />;
}

function App() {
  return (
    <main className="brief-shell">
      <section className="masthead">
        <div className="masthead-copy">
          <div className="eyebrow"><Newspaper size={16} /> Issue 0 Prototype</div>
          <h1>Mihir Market Brief</h1>
          <p>
            A banking-caliber market newsletter: free-source reporting, professional synthesis,
            visual market context, and a weekly deal thread built for compounding judgment.
          </p>
        </div>
        <div className="masthead-panel">
          <div>
            <span className="panel-label">Editorial standard</span>
            <strong>Paid-quality judgment, free-source evidence</strong>
          </div>
          <div>
            <span className="panel-label">Primary lens</span>
            <strong>IB prep, investing, and finance business relevance</strong>
          </div>
          <div>
            <span className="panel-label">Next build</span>
            <strong>Automated source pack + designed recurring issue</strong>
          </div>
        </div>
      </section>

      <section className="market-strip" aria-label="Market snapshot">
        {marketTiles.map((tile) => (
          <article className="market-tile" key={tile.label}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <small className={tile.tone}><MetricMove tone={tile.tone} /> {tile.move}</small>
          </article>
        ))}
      </section>

      <section className="grid two-col">
        <article className="section-block lead-block">
          <div className="section-heading">
            <Radar size={20} />
            <div>
              <span>Front Page</span>
              <h2>What Matters</h2>
            </div>
          </div>
          <div className="headline-list">
            {headlines.map((item, index) => (
              <div className="headline-item" key={item.title}>
                <div className="headline-rank">{String(index + 1).padStart(2, '0')}</div>
                <div>
                  <span className="tag">{item.theme}</span>
                  <h3>{item.title}</h3>
                  <p>{item.signal}</p>
                  <div className="check-row">
                    {item.checks.map((check) => <small key={check}>{check}</small>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <aside className="section-block">
          <div className="section-heading">
            <BriefcaseBusiness size={20} />
            <div>
              <span>Deal Watch</span>
              <h2>Follow One Situation</h2>
            </div>
          </div>
          <div className="deal-card">
            <span className="tag">Template slot</span>
            <h3>Active M&A / IPO / financing candidate</h3>
            <p>
              Each issue tracks one real transaction: strategic rationale, valuation math,
              financing conditions, regulatory path, buyer/seller incentives, and what changed.
            </p>
          </div>
          <div className="timeline">
            {dealTimeline.map((item) => (
              <div className={`timeline-row ${item.status}`} key={item.step}>
                <span></span>
                <p>{item.step}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid chart-grid">
        <article className="section-block chart-block">
          <div className="section-heading">
            <Banknote size={20} />
            <div>
              <span>Macro Desk</span>
              <h2>Curve And Cost Of Capital</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={yieldCurve} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="yieldFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#0f766e" stopOpacity={0.38} />
                  <stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#d8dedb" vertical={false} />
              <XAxis dataKey="tenor" tickLine={false} axisLine={false} />
              <YAxis domain={[4.2, 5.6]} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(value) => [`${value}%`, 'Yield']} />
              <Area type="monotone" dataKey="yield" stroke="#0f766e" strokeWidth={3} fill="url(#yieldFill)" />
            </AreaChart>
          </ResponsiveContainer>
          <p className="analyst-note">
            First-order effect: higher front-end rates keep cash attractive and financing expensive.
            Second-order effect: deal math gets tighter, so strategic rationale has to carry more weight.
          </p>
        </article>

        <article className="section-block chart-block">
          <div className="section-heading">
            <Scale size={20} />
            <div>
              <span>Credit</span>
              <h2>Spread Temperature</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={creditData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#d8dedb" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="hy" name="High yield bps" fill="#7c3aed" radius={[5, 5, 0, 0]} />
              <Line dataKey="ig" name="IG bps" stroke="#0f172a" strokeWidth={3} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="analyst-note">
            Financing windows matter more than index levels for banking. This section turns credit
            conditions into a read on issuance, LBO math, refinancing, and sponsor exits.
          </p>
        </article>

        <article className="section-block chart-block wide">
          <div className="section-heading">
            <LineChart size={20} />
            <div>
              <span>Company Lens</span>
              <h2>Sector Relevance Map</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sectorPulse} layout="vertical" margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#d8dedb" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="sector" tickLine={false} axisLine={false} width={88} />
              <Tooltip formatter={(value) => [value, 'Signal score']} />
              <Bar dataKey="score" radius={[0, 6, 6, 0]}>
                {sectorPulse.map((entry, index) => (
                  <Cell key={entry.sector} fill={['#0f766e', '#2563eb', '#8b5cf6', '#d97706', '#64748b'][index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="grid two-col bottom-grid">
        <article className="section-block">
          <div className="section-heading">
            <BadgeDollarSign size={20} />
            <div>
              <span>IB Learning Corner</span>
              <h2>Translate News Into Banking Work</h2>
            </div>
          </div>
          <ul className="learning-list">
            <li><strong>Valuation:</strong> how rates and earnings revisions move multiples.</li>
            <li><strong>M&A:</strong> why strategic buyers can outbid sponsors when debt is expensive.</li>
            <li><strong>Capital markets:</strong> how windows open/close through credit spreads and volatility.</li>
            <li><strong>Modeling:</strong> one concept per issue tied to the real story being tracked.</li>
          </ul>
        </article>

        <article className="section-block">
          <div className="section-heading">
            <ShieldAlert size={20} />
            <div>
              <span>Source Discipline</span>
              <h2>Evidence Rules</h2>
            </div>
          </div>
          <div className="source-stack">
            {sourceStack.map((source) => <p key={source}>{source}</p>)}
          </div>
          <div className="calendar-callout">
            <CalendarDays size={18} />
            <span>Next: build the intake workflow that collects sources, verifies importance, and outputs Issue 0.</span>
          </div>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

