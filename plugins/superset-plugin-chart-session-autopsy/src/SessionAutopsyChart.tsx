import { CSSProperties, useEffect, useState } from 'react';
import {
  AutopsyColors,
  AutopsyOrientation,
  AutopsyView,
  SessionAutopsyChartProps,
  SessionEvent,
} from './types';

const trunc = (s: string, n: number) =>
  s && s.length > n ? `${s.slice(0, Math.max(n - 1, 1))}…` : s;

/** перенос по словам (длинные слова режутся по символам); последняя строка
 *  ужимается многоточием только если совсем не влезло */
function wrapText(s: string, maxChars: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = '';
  const push = () => { if (line) { out.push(line); line = ''; } };
  const words = (s || '').split(/\s+/).filter(Boolean);
  for (let w of words) {
    while (w.length > maxChars && out.length < maxLines) {
      push();
      out.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (out.length >= maxLines) break;
    const t = line ? `${line} ${w}` : w;
    if (t.length <= maxChars || !line) line = t;
    else { push(); line = w; }
  }
  push();
  if (out.length > maxLines) {
    const head = out.slice(0, maxLines);
    head[maxLines - 1] = `${head[maxLines - 1].slice(0, Math.max(maxChars - 1, 1))}…`;
    return head;
  }
  return out.length ? out : [''];
}

function SvgLines({ lines, x, y, fill, fontSize, anchor, weight, mono }: {
  lines: string[]; x: number; y: number; fill: string; fontSize: number;
  anchor: 'start' | 'middle' | 'end'; weight?: number; mono?: boolean;
}) {
  return (
    <text x={x} y={y} fontSize={fontSize} fill={fill} textAnchor={anchor} fontWeight={weight} fontFamily={mono ? 'monospace' : undefined} dominantBaseline="central">
      {lines.map((ln, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : fontSize + 2}>{ln}</tspan>
      ))}
    </text>
  );
}

function statusFill(e: SessionEvent, c: AutopsyColors): string {
  if (e.status === 'error') return c.error;
  if (e.status === 'warn') return c.warn;
  if (e.status === 'nav') return c.nav;
  return c.ok;
}

function fmtDur(ms: number): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return `${m}м ${s % 60}с`;
}

function tip(e: SessionEvent): string {
  const bits = [`${e.idx}. ${e.step}`];
  if (e.timeLabel) bits.push(e.timeLabel);
  if (e.branch !== 'trunk') bits.push(e.branch);
  if (e.screen) bits.push(e.screen);
  if (Number.isFinite(e.latencyMs)) bits.push(`${Math.round(e.latencyMs as number)} мс`);
  if (e.gapMs > 3000) bits.push(`пауза ${fmtDur(e.gapMs)}`);
  if (e.stateFetch) bits.push(`⟳ стейт ×${e.stateFetch}`);
  if (e.isBack) bits.push('← назад');
  if (e.isRetry) bits.push('↻ повтор');
  if (e.errorCode || e.errorMsg) bits.push(`${e.errorCode || 'ошибка'}${e.errorMsg ? `: ${e.errorMsg}` : ''}`);
  return bits.join(' · ');
}

const prefixOf = (e: SessionEvent) => (e.isBack ? '← ' : e.isRetry ? '↻ ' : '');

/** красная плашка с деталями ошибки (полное сообщение в 2 строки) + выноска */
function errorCallout(e: SessionEvent, ax: number, ay: number, stripY: number, svgW: number, c: AutopsyColors) {
  const boxW = Math.min(360, svgW - 16);
  const maxChars = Math.floor((boxW - 20) / 6.2);
  const msgLines = e.errorMsg ? wrapText(e.errorMsg, maxChars, 2) : [];
  const boxH = 22 + (e.errorCode ? 16 : 0) + msgLines.length * 14 + 8;
  const bx = Math.max(8, Math.min(ax - 24, svgW - boxW - 8));
  const lx = Math.max(bx + 14, Math.min(ax, bx + boxW - 14));
  let cy = stripY + 16;
  return (
    <g key="err-callout">
      <path d={`M${ax} ${ay + 12} L${lx} ${stripY}`} stroke={c.error} strokeWidth={1} strokeDasharray="3 2" fill="none" />
      <rect x={bx} y={stripY} width={boxW} height={boxH} rx={8} fill={c.bgDanger} stroke={c.error} strokeWidth={0.75} />
      <text x={bx + 10} y={cy} fontSize={12} fontWeight={500} fill={c.error} dominantBaseline="central">
        {trunc(`✕ ${e.step}${e.screen ? ` · ${e.screen}` : ''}`, maxChars)}
      </text>
      {e.errorCode ? (
        <text x={bx + 10} y={(cy += 16)} fontSize={11} fontFamily="monospace" fill={c.error} dominantBaseline="central">{e.errorCode}</text>
      ) : null}
      {msgLines.map((ln, i) => (
        <text key={i} x={bx + 10} y={(cy += 14)} fontSize={11} fill={c.textMuted} dominantBaseline="central">{ln}</text>
      ))}
    </g>
  );
}

/* ----------------------------- verdict header ----------------------------- */
function Header({ props }: { props: SessionAutopsyChartProps }) {
  const { meta, diagnostics: d, style } = props;
  const c = style.colors;
  const badge = d.outcome === 'success' ? c.ok : d.outcome === 'error' ? c.error : c.warn;
  const metaBits = [meta.partner, meta.device, meta.user && `user ${meta.user}`, meta.startLabel].filter(Boolean).join(' · ');
  const chip = (label: string, wrap = false) => (
    <span key={label} style={{ background: c.bgSubtle, color: c.textMuted, borderRadius: 6, padding: '3px 9px', fontSize: 12, whiteSpace: wrap ? 'normal' : 'nowrap', maxWidth: '100%' }}>{label}</span>
  );
  return (
    <div style={{ border: `0.5px solid ${c.border}`, borderRadius: 12, padding: '12px 14px', background: c.bg, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: c.textPrimary, wordBreak: 'break-all' }}>Сессия {meta.sessionId}</div>
          {metaBits ? (<div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{metaBits}{d.durationMs ? ` · ${fmtDur(d.durationMs)}` : ''}</div>) : null}
        </div>
        <span style={{ background: badge, color: '#fff', borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>{d.outcomeLabel}</span>
      </div>
      <div style={{ marginTop: 10, padding: '8px 10px', background: d.outcome === 'success' ? c.bgSubtle : c.bgDanger, borderRadius: 8, fontSize: 13, color: d.outcome === 'success' ? c.textPrimary : c.error }}>{d.narrative}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {chip(`Возвратов: ${d.backCount}`)}
        {chip(`Веток: ${d.branchesTried.length || '—'}`)}
        {chip(`Повторов: ${d.retryCount}`)}
        {chip(`Дальше всего: ${d.furthestStep}`, true)}
        {d.rootCause && d.rootCause !== '—' ? chip(`Корень: ${d.rootCause}`, true) : null}
      </div>
    </div>
  );
}

/* ------------------------------- toggles ---------------------------------- */
function Toggle({ view, setView, orientation, setOrientation, c }: {
  view: AutopsyView; setView: (v: AutopsyView) => void;
  orientation: AutopsyOrientation; setOrientation: (o: AutopsyOrientation) => void; c: AutopsyColors;
}) {
  const btn = (active: boolean): CSSProperties => ({
    border: `0.5px solid ${c.border}`, background: active ? c.textPrimary : 'transparent',
    color: active ? c.bg : c.textMuted, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  });
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" style={btn(view === 'swimlane')} onClick={() => setView('swimlane')}>Swimlane</button>
        <button type="button" style={btn(view === 'graph')} onClick={() => setView('graph')}>Граф пути</button>
      </div>
      {view === 'swimlane' ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" style={btn(orientation === 'horizontal')} onClick={() => setOrientation('horizontal')}>↔ время</button>
          <button type="button" style={btn(orientation === 'vertical')} onClick={() => setOrientation('vertical')}>↕ время</button>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- raw event panel ------------------------------ */
const KV = ({ k, v, c }: { k: string; v: unknown; c: AutopsyColors }) => (
  <>
    <div style={{ color: c.textMuted, fontFamily: 'monospace' }}>{k}</div>
    <div style={{ color: c.textPrimary, wordBreak: 'break-word' }}>
      {v === null || v === undefined || v === '' ? '—' : String(v)}
    </div>
  </>
);

function RawPanel({ e, c, onClose }: { e: SessionEvent; c: AutopsyColors; onClose: () => void }) {
  // JSON-поля (напр. details = мапа Details) — сворачиваемый блок (их бывает много)
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const plain: [string, unknown][] = [];
  const jsonFields: { key: string; entries: [string, unknown][] }[] = [];
  Object.entries(e.raw).forEach(([k, v]) => {
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(v);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          jsonFields.push({
            key: k,
            entries: Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0])),
          });
          return;
        }
      } catch {
        /* не JSON — покажем как есть */
      }
    }
    plain.push([k, v]);
  });
  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(110px,170px) 1fr',
    gap: '3px 12px',
    padding: '10px 12px',
    fontSize: 12,
  };
  return (
    <div style={{ marginTop: 10, border: `0.5px solid ${c.border}`, borderRadius: 10, background: c.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: `0.5px solid ${c.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: e.status === 'error' ? c.error : c.textPrimary }}>
          {e.status === 'error' ? '✕ ' : ''}Событие {e.idx} · {e.step}{e.timeLabel ? ` · ${e.timeLabel}` : ''}
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" style={{ border: 'none', background: 'transparent', color: c.textMuted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
      </div>
      <div style={grid}>
        {plain.map(([k, v]) => (
          <KV key={k} k={k} v={v} c={c} />
        ))}
      </div>
      {jsonFields.map(jf => (
        <div key={jf.key} style={{ borderTop: `0.5px solid ${c.border}` }}>
          <button
            type="button"
            onClick={() => setOpen(o => ({ ...o, [jf.key]: !o[jf.key] }))}
            style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '8px 12px', fontSize: 12, color: c.textMuted, fontFamily: 'monospace' }}
          >
            {open[jf.key] ? '▾' : '▸'} {jf.key} · {jf.entries.length} полей
          </button>
          {open[jf.key] ? (
            <div style={{ ...grid, paddingTop: 0 }}>
              {jf.entries.map(([sk, sv]) => (
                <KV key={sk} k={sk} v={sv} c={c} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- swimlane --------------------------------- */
function Swimlane({ props, orientation, onPick }: { props: SessionAutopsyChartProps; orientation: AutopsyOrientation; onPick: (e: SessionEvent) => void }) {
  const { events, lanes, laneLabels, style, width } = props;
  const c = style.colors;
  const err = events.find(e => e.status === 'error');
  const labelSpace = 88;
  const horizontal = orientation === 'horizontal';
  const errPad = err ? 86 : 0;

  if (horizontal) {
    const laneH = 92;
    const topPad = 10;
    const usable = Math.max(width - labelSpace - 24, 160);
    const step = usable / Math.max(events.length, 1);
    const svgW = width - 4;
    const lanesBottom = topPad + lanes.length * laneH;
    const svgH = lanesBottom + errPad + 30;
    const laneY = (b: string) => topPad + lanes.indexOf(b) * laneH + laneH / 2;
    const nodeX = (i: number) => labelSpace + step * (i + 0.5);
    const lineChars = Math.max(7, Math.floor(step / 5.8));

    return (
      <svg width={svgW} height={svgH} style={{ maxWidth: '100%' }}>
        {lanes.map((b, li) => (
          <g key={b}>
            <rect x={labelSpace - 6} y={topPad + li * laneH + 3} width={svgW - labelSpace - 2} height={laneH - 6} rx={6} fill={li % 2 ? 'transparent' : c.bgSubtle} />
            <rect x={labelSpace - 6} y={topPad + li * laneH + 3} width={3} height={laneH - 6} fill={style.branchColors[b] || c.nav} />
            <text x={8} y={laneY(b)} fontSize={12} fill={c.textMuted} dominantBaseline="central">{trunc(laneLabels[b] || b, 11)}</text>
          </g>
        ))}
        <polyline points={events.map((e, i) => `${nodeX(i)},${laneY(e.branch)}`).join(' ')} fill="none" stroke={c.border} strokeWidth={1.5} />
        {events.map((e, i) => {
          const x = nodeX(i);
          const y = laneY(e.branch);
          const r = e.status === 'error' ? 12 : 9;
          return (
            <g key={e.idx} style={{ cursor: 'pointer' }} onClick={() => onPick(e)}>
              <title>{tip(e)}</title>
              {e.isRetry ? <circle cx={x} cy={y} r={r + 3} fill="none" stroke={statusFill(e, c)} strokeWidth={1} strokeDasharray="2 2" /> : null}
              <circle cx={x} cy={y} r={r} fill={statusFill(e, c)} stroke={c.bg} strokeWidth={3} />
              <text x={x} y={y} fontSize={10} fill="#fff" textAnchor="middle" dominantBaseline="central">{e.idx}</text>
              {e.stateFetch ? <text x={x + r} y={y - r} fontSize={11} fill={c.textMuted} textAnchor="start">⟳</text> : null}
              <SvgLines lines={wrapText(prefixOf(e) + e.step, lineChars, 3)} x={x} y={y + r + 14} fill={e.status === 'error' ? c.error : c.textMuted} fontSize={11} anchor="middle" />
            </g>
          );
        })}
        {err ? errorCallout(err, nodeX(err.idx - 1), laneY(err.branch), lanesBottom + 8, svgW, c) : null}
        <line x1={labelSpace} y1={svgH - 6} x2={svgW - 24} y2={svgH - 6} stroke={c.border} strokeWidth={0.5} />
        <text x={svgW - 22} y={svgH - 10} fontSize={11} fill={c.textMuted} textAnchor="end">время →</text>
      </svg>
    );
  }

  const rowH = 46;
  const timeCol = 56;
  const topPad = 26;
  const usable = Math.max(width - timeCol - 12, 160);
  const laneW = usable / lanes.length;
  const contentBottom = topPad + events.length * rowH;
  const svgH = contentBottom + errPad + 12;
  const svgW = width - 4;
  const laneX = (b: string) => timeCol + lanes.indexOf(b) * laneW + laneW / 2;
  const nodeY = (i: number) => topPad + rowH * (i + 0.5);
  const vChars = Math.max(8, Math.floor(laneW / 6.4));

  return (
    <svg width={svgW} height={svgH} style={{ maxWidth: '100%' }}>
      {lanes.map((b, li) => (
        <g key={b}>
          <rect x={timeCol + li * laneW + 2} y={topPad - 4} width={laneW - 4} height={contentBottom - topPad + 8} rx={6} fill={li % 2 ? 'transparent' : c.bgSubtle} />
          <rect x={timeCol + li * laneW + 2} y={topPad - 4} width={laneW - 4} height={3} fill={style.branchColors[b] || c.nav} />
          <text x={timeCol + li * laneW + laneW / 2} y={14} fontSize={12} fill={c.textMuted} textAnchor="middle">{trunc(laneLabels[b] || b, 16)}</text>
        </g>
      ))}
      <polyline points={events.map((e, i) => `${laneX(e.branch)},${nodeY(i)}`).join(' ')} fill="none" stroke={c.border} strokeWidth={1.5} />
      {events.map((e, i) => {
        const x = laneX(e.branch);
        const y = nodeY(i);
        const r = e.status === 'error' ? 12 : 9;
        return (
          <g key={e.idx} style={{ cursor: 'pointer' }} onClick={() => onPick(e)}>
            <title>{tip(e)}</title>
            <text x={timeCol - 8} y={y} fontSize={11} fill={e.status === 'error' ? c.error : c.textMuted} textAnchor="end" dominantBaseline="central">{e.timeLabel || e.idx}</text>
            {e.isRetry ? <circle cx={x} cy={y} r={r + 3} fill="none" stroke={statusFill(e, c)} strokeWidth={1} strokeDasharray="2 2" /> : null}
            <circle cx={x} cy={y} r={r} fill={statusFill(e, c)} stroke={c.bg} strokeWidth={3} />
            <text x={x} y={y} fontSize={10} fill="#fff" textAnchor="middle" dominantBaseline="central">{e.idx}</text>
            {e.stateFetch ? <text x={x + r} y={y - r} fontSize={11} fill={c.textMuted} textAnchor="start">⟳</text> : null}
            <SvgLines lines={wrapText(prefixOf(e) + e.step, vChars, 2)} x={x + r + 6} y={y} fill={e.status === 'error' ? c.error : c.textPrimary} fontSize={11} anchor="start" />
          </g>
        );
      })}
      {err ? errorCallout(err, laneX(err.branch), nodeY(err.idx - 1), contentBottom + 8, svgW, c) : null}
    </svg>
  );
}

/* -------------------------------- graph ----------------------------------- */
function Graph({ props, onPick }: { props: SessionAutopsyChartProps; onPick: (e: SessionEvent) => void }) {
  const { events, lanes, laneLabels, canonicalSteps, style, width } = props;
  const c = style.colors;
  const cidx = (s: string) => {
    const i = canonicalSteps.indexOf(s);
    return i < 0 ? canonicalSteps.length : i;
  };
  const labelSpace = 84;
  const colCount = Math.max(canonicalSteps.length, 1);
  const colW = Math.max((width - 4 - labelSpace - 16) / colCount, 78);
  const laneH = 78;
  const topPad = 14;
  const svgW = Math.max(width - 4, labelSpace + 16 + colCount * colW);
  const svgH = topPad + lanes.length * laneH + 16;
  const nx = (s: string) => labelSpace + colW * (cidx(s) + 0.5);
  const ny = (b: string) => topPad + lanes.indexOf(b) * laneH + laneH / 2;
  const nodeW = Math.min(colW - 10, 124);
  const nodeH = 42;

  const states = new Map<string, { branch: string; step: string; visits: number; error: boolean; stateFetch: number }>();
  events.forEach(e => {
    const k = `${e.branch}|${e.step}`;
    const st = states.get(k) || { branch: e.branch, step: e.step, visits: 0, error: false, stateFetch: 0 };
    st.visits += 1;
    if (e.status === 'error') st.error = true;
    st.stateFetch += e.stateFetch;
    states.set(k, st);
  });
  const edges = new Map<string, { from: string; to: string; count: number; back: boolean }>();
  for (let i = 1; i < events.length; i += 1) {
    const a = events[i - 1];
    const b = events[i];
    if (a.step === b.step && a.branch === b.branch) continue;
    const fk = `${a.branch}|${a.step}`;
    const tk = `${b.branch}|${b.step}`;
    const ek = `${fk}>${tk}`;
    const ed = edges.get(ek) || { from: fk, to: tk, count: 0, back: cidx(b.step) < cidx(a.step) };
    ed.count += 1;
    edges.set(ek, ed);
  }
  const pos = (k: string) => {
    const st = states.get(k)!;
    return { x: nx(st.step), y: ny(st.branch) };
  };

  return (
    <svg width={svgW} height={svgH} style={{ maxWidth: '100%' }}>
      <defs>
        <marker id="sa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
        </marker>
      </defs>
      {lanes.map(b => (
        <text key={b} x={8} y={ny(b)} fontSize={12} fill={c.textMuted} dominantBaseline="central">{trunc(laneLabels[b] || b, 11)}</text>
      ))}
      {Array.from(edges.values()).map(ed => {
        const p1 = pos(ed.from);
        const p2 = pos(ed.to);
        if (ed.back) {
          const mx = (p1.x + p2.x) / 2;
          const my = Math.min(p1.y, p2.y) - 30;
          return <path key={`${ed.from}>${ed.to}`} d={`M${p1.x} ${p1.y} Q${mx} ${my} ${p2.x} ${p2.y}`} fill="none" stroke={c.warn} strokeWidth={1.5} strokeDasharray="5 3" markerEnd="url(#sa-arrow)" />;
        }
        return <line key={`${ed.from}>${ed.to}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={c.textMuted} strokeWidth={1.5} markerEnd="url(#sa-arrow)" />;
      })}
      {Array.from(states.values()).map(st => {
        const x = nx(st.step);
        const y = ny(st.branch);
        const col = st.error ? c.error : style.branchColors[st.branch] || c.nav;
        const ev = events.find(e => e.branch === st.branch && e.step === st.step)!;
        const lines = wrapText((st.error ? '✕ ' : '') + st.step, Math.max(8, Math.floor(nodeW / 6.0)), 2);
        const startY = y - (lines.length - 1) * 6;
        return (
          <g key={`${st.branch}|${st.step}`} style={{ cursor: 'pointer' }} onClick={() => onPick(ev)}>
            <title>{tip(ev)}{st.visits > 1 ? ` · заходов: ${st.visits}` : ''}</title>
            <rect x={x - nodeW / 2} y={y - nodeH / 2} width={nodeW} height={nodeH} rx={8} fill={c.bg} stroke={col} strokeWidth={st.error ? 1.5 : 1} />
            <SvgLines lines={lines} x={x} y={startY} fill={st.error ? c.error : c.textPrimary} fontSize={11} anchor="middle" />
            {st.visits > 1 ? (
              <g>
                <circle cx={x + nodeW / 2 - 2} cy={y - nodeH / 2 + 1} r={8} fill={c.warn} />
                <text x={x + nodeW / 2 - 2} y={y - nodeH / 2 + 1} fontSize={10} fill="#fff" textAnchor="middle" dominantBaseline="central">{st.visits}</text>
              </g>
            ) : null}
            {st.stateFetch ? <text x={x - nodeW / 2 + 2} y={y - nodeH / 2 - 2} fontSize={11} fill={c.textMuted} textAnchor="start">⟳</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------- main FC ---------------------------------- */
export default function SessionAutopsyChart(props: SessionAutopsyChartProps) {
  const { width, height, events, style, needsSession } = props;
  const c = style.colors;
  const [view, setView] = useState<AutopsyView>(style.view);
  const [orientation, setOrientation] = useState<AutopsyOrientation>(style.orientation);
  const [selected, setSelected] = useState<SessionEvent | null>(null);
  useEffect(() => setView(style.view), [style.view]);
  useEffect(() => setOrientation(style.orientation), [style.orientation]);

  if (needsSession) {
    return (
      <div style={{ width, height, overflow: 'auto', color: c.textPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16, boxSizing: 'border-box' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Выберите сессию</div>
          <div style={{ fontSize: 13, color: c.textMuted }}>
            Кликните по ячейке <b>session_id</b> в «Ленте сбоев» (или задайте фильтр «Сессия» / Session ID) — разбор появится здесь.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width, height, overflow: 'auto', color: c.textPrimary, fontFamily: 'inherit', boxSizing: 'border-box', padding: 2 }}>
      <Header props={props} />
      {events.length === 0 ? (
        <div style={{ color: c.textMuted, fontSize: 13, padding: 12 }}>Нет событий для этой сессии. Проверьте Session ID и маппинг колонок.</div>
      ) : (
        <>
          <Toggle view={view} setView={setView} orientation={orientation} setOrientation={setOrientation} c={c} />
          {view === 'swimlane' ? (
            <Swimlane props={props} orientation={orientation} onPick={setSelected} />
          ) : (
            <Graph props={props} onPick={setSelected} />
          )}
          {selected ? (
            <RawPanel e={selected} c={c} onClose={() => setSelected(null)} />
          ) : (
            <div style={{ fontSize: 11, color: c.textMuted, marginTop: 8 }}>Клик по шагу — raw-данные события</div>
          )}
        </>
      )}
    </div>
  );
}
