import { CSSProperties, useEffect, useState } from 'react';
import {
  AutopsyColors,
  AutopsyOrientation,
  AutopsyView,
  SessionAutopsyChartProps,
  SessionEvent,
} from './types';

const trunc = (s: string, n: number) =>
  s && s.length > n ? `${s.slice(0, n - 1)}…` : s;

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

/* ----------------------------- verdict header ----------------------------- */
function Header({
  props,
}: {
  props: SessionAutopsyChartProps;
}) {
  const { meta, diagnostics: d, style } = props;
  const c = style.colors;
  const badge =
    d.outcome === 'success' ? c.ok : d.outcome === 'error' ? c.error : c.warn;
  const metaBits = [meta.partner, meta.device, meta.user && `user ${meta.user}`, meta.startLabel]
    .filter(Boolean)
    .join(' · ');
  const chip = (label: string) => (
    <span
      key={label}
      style={{
        background: c.bgSubtle,
        color: c.textMuted,
        borderRadius: 6,
        padding: '3px 9px',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
  return (
    <div
      style={{
        border: `0.5px solid ${c.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        background: c.bg,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: c.textPrimary }}>
            Сессия {trunc(meta.sessionId, 22)}
          </div>
          {metaBits ? (
            <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
              {metaBits}
              {d.durationMs ? ` · ${fmtDur(d.durationMs)}` : ''}
            </div>
          ) : null}
        </div>
        <span
          style={{
            background: badge,
            color: '#fff',
            borderRadius: 999,
            padding: '3px 12px',
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {d.outcomeLabel}
        </span>
      </div>
      <div
        style={{
          marginTop: 10,
          padding: '8px 10px',
          background: d.outcome === 'success' ? c.bgSubtle : c.bgDanger,
          borderRadius: 8,
          fontSize: 13,
          color: d.outcome === 'success' ? c.textPrimary : c.error,
        }}
      >
        {d.narrative}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {chip(`Возвратов: ${d.backCount}`)}
        {chip(`Веток: ${d.branchesTried.length || '—'}`)}
        {chip(`Повторов: ${d.retryCount}`)}
        {chip(`Дальше всего: ${trunc(d.furthestStep, 18)}`)}
        {d.rootCause && d.rootCause !== '—' ? chip(`Корень: ${trunc(d.rootCause, 28)}`) : null}
      </div>
    </div>
  );
}

/* ------------------------------- toggles ---------------------------------- */
function Toggle({
  view,
  setView,
  orientation,
  setOrientation,
  c,
}: {
  view: AutopsyView;
  setView: (v: AutopsyView) => void;
  orientation: AutopsyOrientation;
  setOrientation: (o: AutopsyOrientation) => void;
  c: AutopsyColors;
}) {
  const btn = (active: boolean): CSSProperties => ({
    border: `0.5px solid ${c.border}`,
    background: active ? c.textPrimary : 'transparent',
    color: active ? c.bg : c.textMuted,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  });
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" style={btn(view === 'swimlane')} onClick={() => setView('swimlane')}>
          Swimlane
        </button>
        <button type="button" style={btn(view === 'graph')} onClick={() => setView('graph')}>
          Граф пути
        </button>
      </div>
      {view === 'swimlane' ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" style={btn(orientation === 'horizontal')} onClick={() => setOrientation('horizontal')}>
            ↔ время
          </button>
          <button type="button" style={btn(orientation === 'vertical')} onClick={() => setOrientation('vertical')}>
            ↕ время
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- swimlane --------------------------------- */
function Swimlane({
  props,
  orientation,
}: {
  props: SessionAutopsyChartProps;
  orientation: AutopsyOrientation;
}) {
  const { events, lanes, laneLabels, style, width } = props;
  const c = style.colors;
  const labelSpace = 86;
  const horizontal = orientation === 'horizontal';

  if (horizontal) {
    const laneH = 56;
    const topPad = 10;
    const minStep = 66;
    const usable = Math.max(width - labelSpace - 24, 200);
    const step = Math.max(usable / Math.max(events.length, 1), minStep);
    const svgW = Math.max(width - 4, labelSpace + 24 + events.length * step);
    const svgH = topPad + lanes.length * laneH + 36;
    const laneY = (b: string) => topPad + lanes.indexOf(b) * laneH + laneH / 2;
    const nodeX = (i: number) => labelSpace + step * (i + 0.5);

    return (
      <svg width={svgW} height={svgH}>
        {lanes.map((b, li) => (
          <g key={b}>
            <rect x={labelSpace - 6} y={topPad + li * laneH + 3} width={svgW - labelSpace - 6} height={laneH - 6} rx={6} fill={c.bgSubtle} />
            <rect x={labelSpace - 6} y={topPad + li * laneH + 3} width={3} height={laneH - 6} fill={style.branchColors[b] || c.nav} />
            <text x={8} y={laneY(b)} fontSize={12} fill={c.textMuted} dominantBaseline="central">
              {trunc(laneLabels[b] || b, 11)}
            </text>
          </g>
        ))}
        <polyline
          points={events.map((e, i) => `${nodeX(i)},${laneY(e.branch)}`).join(' ')}
          fill="none"
          stroke={c.border}
          strokeWidth={1.5}
        />
        {events.map((e, i) => {
          const x = nodeX(i);
          const y = laneY(e.branch);
          const r = e.status === 'error' ? 12 : 10;
          return (
            <g key={e.idx}>
              <circle cx={x} cy={y} r={r} fill={statusFill(e, c)} stroke={c.bg} strokeWidth={3} />
              {e.isRetry ? <circle cx={x} cy={y} r={r + 3} fill="none" stroke={statusFill(e, c)} strokeWidth={1} strokeDasharray="2 2" /> : null}
              <text x={x} y={y} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="central">
                {e.idx}
              </text>
              <text x={x} y={y + r + 12} fontSize={11} fill={e.status === 'error' ? c.error : c.textMuted} textAnchor="middle">
                {trunc((e.isBack ? '← ' : e.isRetry ? '↻ ' : '') + e.step, 11)}
              </text>
            </g>
          );
        })}
        <text x={labelSpace} y={svgH - 8} fontSize={11} fill={c.textMuted}>
          {events[0]?.timeLabel || ''}
        </text>
        <text x={svgW - 24} y={svgH - 8} fontSize={11} fill={c.textMuted} textAnchor="end">
          время →
        </text>
      </svg>
    );
  }

  // vertical: lanes = columns, time downward
  const rowH = 50;
  const timeCol = 56;
  const topPad = 26;
  const usable = Math.max(width - timeCol - 16, 200);
  const laneW = usable / lanes.length;
  const svgH = topPad + events.length * rowH + 16;
  const svgW = Math.max(width - 4, timeCol + lanes.length * 120);
  const laneX = (b: string) => timeCol + lanes.indexOf(b) * laneW + laneW / 2;
  const nodeY = (i: number) => topPad + rowH * (i + 0.5);

  return (
    <svg width={svgW} height={svgH}>
      {lanes.map((b, li) => (
        <g key={b}>
          <rect x={timeCol + li * laneW + 2} y={topPad - 4} width={laneW - 4} height={svgH - topPad} rx={6} fill={li % 2 ? 'transparent' : c.bgSubtle} />
          <text x={timeCol + li * laneW + laneW / 2} y={14} fontSize={12} fill={c.textMuted} textAnchor="middle">
            {trunc(laneLabels[b] || b, 12)}
          </text>
        </g>
      ))}
      <polyline
        points={events.map((e, i) => `${laneX(e.branch)},${nodeY(i)}`).join(' ')}
        fill="none"
        stroke={c.border}
        strokeWidth={1.5}
      />
      {events.map((e, i) => {
        const x = laneX(e.branch);
        const y = nodeY(i);
        const r = e.status === 'error' ? 12 : 10;
        return (
          <g key={e.idx}>
            <text x={timeCol - 8} y={y} fontSize={11} fill={e.status === 'error' ? c.error : c.textMuted} textAnchor="end" dominantBaseline="central">
              {e.timeLabel || e.idx}
            </text>
            <circle cx={x} cy={y} r={r} fill={statusFill(e, c)} stroke={c.bg} strokeWidth={3} />
            {e.isRetry ? <circle cx={x} cy={y} r={r + 3} fill="none" stroke={statusFill(e, c)} strokeWidth={1} strokeDasharray="2 2" /> : null}
            <text x={x} y={y} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="central">
              {e.idx}
            </text>
            <text x={x + r + 6} y={y} fontSize={11} fill={e.status === 'error' ? c.error : c.textPrimary} dominantBaseline="central">
              {trunc((e.isBack ? '← ' : e.isRetry ? '↻ ' : '') + e.step, 14)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------------------- graph ----------------------------------- */
function Graph({ props }: { props: SessionAutopsyChartProps }) {
  const { events, lanes, laneLabels, canonicalSteps, style, width } = props;
  const c = style.colors;
  const cidx = (s: string) => {
    const i = canonicalSteps.indexOf(s);
    return i < 0 ? canonicalSteps.length : i;
  };
  const labelSpace = 86;
  const colCount = Math.max(canonicalSteps.length, 1);
  const colW = Math.max((Math.max(width - 4, 360) - labelSpace - 24) / colCount, 96);
  const laneH = 64;
  const topPad = 12;
  const svgW = Math.max(width - 4, labelSpace + 24 + colCount * colW);
  const svgH = topPad + lanes.length * laneH + 20;
  const nx = (s: string) => labelSpace + colW * (cidx(s) + 0.5);
  const ny = (b: string) => topPad + lanes.indexOf(b) * laneH + laneH / 2;

  // states (branch|step) with visit count + error flag
  const states = new Map<string, { branch: string; step: string; visits: number; error: boolean }>();
  events.forEach(e => {
    const k = `${e.branch}|${e.step}`;
    const st = states.get(k) || { branch: e.branch, step: e.step, visits: 0, error: false };
    st.visits += 1;
    if (e.status === 'error') st.error = true;
    states.set(k, st);
  });
  // edges between consecutive states
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
    <svg width={svgW} height={svgH}>
      <defs>
        <marker id="sa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
        </marker>
      </defs>
      {lanes.map(b => (
        <text key={b} x={8} y={ny(b)} fontSize={12} fill={c.textMuted} dominantBaseline="central">
          {trunc(laneLabels[b] || b, 11)}
        </text>
      ))}
      {Array.from(edges.values()).map(ed => {
        const p1 = pos(ed.from);
        const p2 = pos(ed.to);
        if (ed.back) {
          const mx = (p1.x + p2.x) / 2;
          const my = Math.min(p1.y, p2.y) - 26;
          return (
            <path
              key={`${ed.from}>${ed.to}`}
              d={`M${p1.x} ${p1.y} Q${mx} ${my} ${p2.x} ${p2.y}`}
              fill="none"
              stroke={c.warn}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              markerEnd="url(#sa-arrow)"
            />
          );
        }
        return (
          <line
            key={`${ed.from}>${ed.to}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={c.textMuted}
            strokeWidth={1.5}
            markerEnd="url(#sa-arrow)"
          />
        );
      })}
      {Array.from(states.values()).map(st => {
        const x = nx(st.step);
        const y = ny(st.branch);
        const w = Math.min(colW - 14, 104);
        const col = st.error ? c.error : style.branchColors[st.branch] || c.nav;
        return (
          <g key={`${st.branch}|${st.step}`}>
            <rect x={x - w / 2} y={y - 15} width={w} height={30} rx={8} fill={c.bg} stroke={col} strokeWidth={st.error ? 1.5 : 1} />
            <text x={x} y={y} fontSize={11} fill={c.textPrimary} textAnchor="middle" dominantBaseline="central">
              {trunc((st.error ? '✕ ' : '') + st.step, Math.floor(w / 7))}
            </text>
            {st.visits > 1 ? (
              <g>
                <circle cx={x + w / 2 - 2} cy={y - 14} r={8} fill={c.warn} />
                <text x={x + w / 2 - 2} y={y - 14} fontSize={10} fill="#fff" textAnchor="middle" dominantBaseline="central">
                  {st.visits}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------- main FC ---------------------------------- */
export default function SessionAutopsyChart(props: SessionAutopsyChartProps) {
  const { width, height, events, style } = props;
  const c = style.colors;
  const [view, setView] = useState<AutopsyView>(style.view);
  const [orientation, setOrientation] = useState<AutopsyOrientation>(style.orientation);
  useEffect(() => setView(style.view), [style.view]);
  useEffect(() => setOrientation(style.orientation), [style.orientation]);

  return (
    <div style={{ width, height, overflow: 'auto', color: c.textPrimary, fontFamily: 'inherit' }}>
      <Header props={props} />
      {events.length === 0 ? (
        <div style={{ color: c.textMuted, fontSize: 13, padding: 12 }}>
          Нет событий для этой сессии. Проверьте Session ID и маппинг колонок.
        </div>
      ) : (
        <>
          <Toggle view={view} setView={setView} orientation={orientation} setOrientation={setOrientation} c={c} />
          {view === 'swimlane' ? <Swimlane props={props} orientation={orientation} /> : <Graph props={props} />}
        </>
      )}
    </div>
  );
}
