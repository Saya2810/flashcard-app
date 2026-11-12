import { useState, type ReactNode } from 'react';
import { Card, Icon, cx } from './ui';

export interface Series { name: string; color: string }
export interface Datum { label: string; values: number[] }

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 4, 5, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** Frame for every chart: title, legend and a toggleable table view. */
export function ChartCard({ title, hint, series, table, children }: { title: string; hint?: string; series?: Series[]; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="font-bold">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <button type="button" aria-pressed={asTable} aria-label={asTable ? 'Als Diagramm zeigen' : 'Als Tabelle zeigen'} onClick={() => setAsTable(!asTable)}
          className={cx('grid h-10 w-10 place-items-center rounded-full', asTable ? 'bg-accent text-on-accent' : 'text-muted')}>
          <Icon name={asTable ? 'chart' : 'table'} size={18} />
        </button>
      </div>
      {series && series.length > 1 && !asTable && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
      <div className="mt-3">
        {asTable ? (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead><tr>{table.head.map((h) => <th key={h} className="sticky top-0 bg-surface py-1.5 pr-3 text-xs font-semibold text-muted">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="py-1.5 pr-3 tabular-nums" dir="auto">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : children}
      </div>
    </Card>
  );
}

const W = 340, H = 168, ML = 30, MR = 8, MT = 8, MB = 22;
const IW = W - ML - MR, IH = H - MT - MB;

function Grid({ max }: { max: number }) {
  return (
    <g>
      {[0, 0.5, 1].map((f) => {
        const y = MT + IH * (1 - f);
        return (
          <g key={f}>
            <line x1={ML} x2={W - MR} y1={y} y2={y} stroke="rgb(var(--line))" strokeWidth={1} strokeDasharray={f === 0 ? undefined : '2 4'} />
            <text x={ML - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="rgb(var(--muted))">{Math.round(max * f)}</text>
          </g>
        );
      })}
    </g>
  );
}

function Readout({ datum, series, empty }: { datum: Datum | null; series: Series[]; empty: string }) {
  return (
    <div className="mb-1 min-h-[1.25rem] text-xs text-muted" aria-live="polite">
      {datum ? (
        <span><span className="font-semibold text-ink">{datum.label}</span>{' – '}{series.map((s, i) => `${series.length > 1 ? s.name + ' ' : ''}${datum.values[i]}`).join(', ')}</span>
      ) : empty}
    </div>
  );
}

const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
};

/** Column chart (stacked for several series). Tapping a column shows its values. */
export function BarChart({ data, series, labelEvery }: { data: Datum[]; series: Series[]; labelEvery?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => d.values.reduce((a, b) => a + b, 0))));
  const band = IW / Math.max(1, data.length);
  const bw = Math.min(20, band * 0.68);
  const every = labelEvery ?? Math.ceil(data.length / 7);
  return (
    <div>
      <Readout datum={sel !== null ? data[sel] : null} series={series} empty="Säule antippen für genaue Werte" />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Säulendiagramm" onPointerLeave={() => setSel(null)}>
        <Grid max={max} />
        {data.map((d, i) => {
          const x = ML + band * i + (band - bw) / 2;
          let y = MT + IH;
          const last = d.values.map((v, k) => (v > 0 ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
          return (
            <g key={i} opacity={sel === null || sel === i ? 1 : 0.4}>
              {d.values.map((v, k) => {
                if (v <= 0) return null;
                const full = (v / max) * IH;
                const h = Math.max(1.5, full - (k > 0 ? 2 : 0));
                y -= full;
                return k === last
                  ? <path key={k} d={topRounded(x, y, bw, h, 4)} fill={series[k].color} />
                  : <rect key={k} x={x} y={y} width={bw} height={h} fill={series[k].color} />;
              })}
              {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="rgb(var(--muted))">{d.label}</text>}
              <rect x={ML + band * i} y={MT} width={band} height={IH + MB} fill="transparent" onPointerEnter={() => setSel(i)} onClick={() => setSel(i)} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Lines over time; tapping shows the values for that day. */
export function LineChart({ data, series }: { data: Datum[]; series: Series[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.flatMap((d) => d.values)));
  const n = data.length;
  const px = (i: number) => ML + (n <= 1 ? IW / 2 : (IW * i) / (n - 1));
  const py = (v: number) => MT + IH * (1 - v / max);
  const every = Math.ceil(n / 6);
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setSel(Math.min(n - 1, Math.max(0, Math.round(((x - ML) / IW) * (n - 1)))));
  };
  return (
    <div>
      <Readout datum={sel !== null ? data[sel] : null} series={series} empty="Diagramm antippen für genaue Werte" />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Liniendiagramm"
        onPointerLeave={() => setSel(null)}
        onPointerMove={pick} onPointerDown={pick}>
        <Grid max={max} />
        {sel !== null && <line x1={px(sel)} x2={px(sel)} y1={MT} y2={MT + IH} stroke="rgb(var(--muted))" strokeWidth={1} />}
        {series.map((s, k) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={data.map((d, i) => `${px(i)},${py(d.values[k])}`).join(' ')} />
            {(sel !== null || n === 1) && <circle cx={px(sel ?? 0)} cy={py(data[sel ?? 0].values[k])} r={4.5} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2} />}
          </g>
        ))}
        {data.map((d, i) => i % every === 0 && <text key={i} x={px(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'middle'} fontSize={10} fill="rgb(var(--muted))">{d.label}</text>)}
      </svg>
    </div>
  );
}

/** One bar split into shares, with a labelled legend (never colour alone). */
export function SegmentBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full bg-sunken" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color, minWidth: 4 }} />)}
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-[4px]" style={{ background: p.color }} />
            <span className="flex-1">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.value}</span>
            <span className="w-11 text-right text-xs tabular-nums text-muted">{total ? Math.round((p.value / total) * 100) : 0} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars with the word on the left and the value on the right. */
export function HBarList({ rows, color }: { rows: { key: string; label: ReactNode; value: number; note?: string }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums"><span className="font-semibold">{r.value}</span>{r.note && <span className="ml-1.5 text-xs text-muted">{r.note}</span>}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color, minWidth: 4 }} /></div>
        </li>
      ))}
    </ul>
  );
}
