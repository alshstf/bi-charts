import { useEffect, useLayoutEffect, useRef } from 'react';
import { styled } from '@apache-superset/core/theme';
import { getNumberFormatter } from '@superset-ui/core';
import { init, use } from 'echarts/core';
import type { EChartsType } from 'echarts/core';
import { CustomChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  FunnelStep,
  SplitFunnelChartProps,
  SplitFunnelData,
  SplitFunnelStyle,
} from './types';

use([CustomChart, LegendComponent, TooltipComponent, CanvasRenderer]);

const Styles = styled.div<{ height: number; width: number }>`
  height: ${({ height }: { height: number }) => height}px;
  width: ${({ width }: { width: number }) => width}px;
  overflow: hidden;
`;

const numFmt = getNumberFormatter(',d');
const pctFmt = (v: number) =>
  Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—';

interface Connector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface RectMeta {
  step?: string;
  branch?: string;
  facet?: string | null;
}

interface Geom {
  rects: {
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string;
    label: string;
    labelColor: string;
    bold?: boolean;
    labelAlign?: 'left' | 'center' | 'right';
    meta?: RectMeta;
    /** подсветка утечки: бейдж «▼ NN%» + блок выпавшего объёма */
    leak?: { drop: number; lostW: number; badgeDX: number };
  }[];
  connectors: Connector[];
  texts?: { x: number; y: number; text: string; color: string }[];
}

/** прямоугольник для hit-test правого клика */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  meta: RectMeta;
}

function shiftGeom(g: Geom, dx: number, dy: number): Geom {
  return {
    rects: g.rects.map(r => ({ ...r, x: r.x + dx, y: r.y + dy })),
    connectors: g.connectors.map(c => ({
      ...c,
      x1: c.x1 + dx,
      y1: c.y1 + dy,
      x2: c.x2 + dx,
      y2: c.y2 + dy,
    })),
    texts: (g.texts ?? []).map(t => ({ ...t, x: t.x + dx, y: t.y + dy })),
  };
}

function geomBottom(layout: {
  trunk: Geom;
  branches: Record<string, Geom>;
}): number {
  let max = 0;
  const scan = (g: Geom) =>
    g.rects.forEach(r => {
      max = Math.max(max, r.y + r.h);
    });
  scan(layout.trunk);
  Object.values(layout.branches).forEach(scan);
  return max;
}

/** имя финального шага, общего для всех веток (для слияния), либо null */
function detectCommonFinal(data: SplitFunnelData): string | null {
  const names = Object.keys(data.branches);
  if (names.length < 2) return null;
  const lasts = names.map(b => {
    const steps = data.branches[b];
    return steps.length >= 2 ? steps[steps.length - 1].name : null;
  });
  return lasts.every(n => n !== null && n === lasts[0]) ? lasts[0] : null;
}

/** худший провал конверсии: шаг-к-шагу по стволу и внутри веток.
 *  Дробление на ветки (ствол → вход в ветку) утечкой НЕ считается. */
export interface Leak {
  /** null = переход внутри ствола, иначе имя ветки */
  branch: string | null;
  /** индекс шага-приёмника (в стволе или в полном списке шагов ветки) */
  toIndex: number;
  toStep: string;
  /** доля потери 0..1 */
  drop: number;
}

function detectLeak(
  data: SplitFunnelData,
  threshold: number,
  visible: string[],
): Leak | null {
  const cands: Leak[] = [];
  const consider = (
    branch: string | null,
    toIndex: number,
    toStep: string,
    fromValue: number,
    toValue: number,
  ) => {
    if (fromValue <= 0 || toValue < 0) return;
    const drop = 1 - toValue / fromValue;
    if (drop > 0) cands.push({ branch, toIndex, toStep, drop });
  };
  for (let i = 1; i < data.trunk.length; i += 1) {
    consider(
      null,
      i,
      data.trunk[i].name,
      data.trunk[i - 1].value,
      data.trunk[i].value,
    );
  }
  Object.entries(data.branches).forEach(([b, steps]) => {
    if (!visible.includes(b)) return;
    for (let k = 1; k < steps.length; k += 1) {
      consider(b, k, steps[k].name, steps[k - 1].value, steps[k].value);
    }
  });
  if (!cands.length) return null;
  const best = cands.reduce((a, c) => (c.drop > a.drop ? c : a));
  return best.drop >= threshold ? best : null;
}

interface PctBases {
  previous: number;
  container: number;
  e2e: number;
}

function barLabel(
  step: FunnelStep,
  bases: PctBases,
  display: string,
  selected: string[],
): string {
  const head = `${step.name} · ${numFmt(step.value)}`;
  if (display === 'absolute') return head;
  const order: (keyof PctBases)[] = ['previous', 'container', 'e2e'];
  const sel = order.filter(b => selected.includes(b));
  // одинаковые знаменатели не дублируем (например, ствол: container == e2e)
  const parts: { b: keyof PctBases; base: number }[] = [];
  sel.forEach(b => {
    const base = bases[b];
    if (!parts.some(p => p.base === base)) parts.push({ b, base });
  });
  const sfx: Record<string, string> = {
    previous: ' step',
    container: ' of entry',
    e2e: ' E2E',
  };
  const txt = parts
    .map(
      p =>
        pctFmt(p.base > 0 ? step.value / p.base : NaN) +
        (parts.length > 1 ? sfx[p.b] : ''),
    )
    .join(' · ');
  if (display === 'percent') return `${step.name} · ${txt}`;
  return `${head} · ${txt}`;
}

function computeLayout(
  data: SplitFunnelData,
  style: SplitFunnelStyle,
  width: number,
  visible: string[],
  mergeName: string | null,
  collapsed: boolean,
  leak: Leak | null,
  opts: { compact?: boolean; topPad?: number; sparkline?: boolean } = {},
): {
  trunk: Geom;
  branches: Record<string, Geom>;
  toggle: { x: number; y: number } | null;
} {
  const compact = !!opts.compact;
  // sparkline = свёрнутая ячейка сетки: стопка вплотную, без коннекторов
  const sparkline = !!opts.sparkline;
  const pad = compact ? 8 : 16;
  const legendSpace =
    opts.topPad ?? (style.showLegend ? 36 : 10);
  const trunkBarH = sparkline ? 16 : compact ? 22 : 32;
  const gap = sparkline ? 2 : compact ? 6 : 8;
  const connectorH = sparkline ? 6 : compact ? 20 : 28;
  const headerH = compact ? 20 : 28;
  const branchBarH = compact ? 18 : 26;
  const branchGap = compact ? 5 : 6;
  const colGap = compact ? 10 : 16;
  const mh = sparkline ? 18 : compact ? 20 : 26;

  const maxW = Math.max(width - 2 * pad, 60);
  const trunkRef = data.trunk.length ? data.trunk[0].value : 0;
  const trunkFirst = trunkRef || 1;

  const alignX = (base: number, full: number, w: number) =>
    style.barAlignment === 'center'
      ? base + (full - w) / 2
      : style.barAlignment === 'right'
        ? base + full - w
        : base;

  const trunkGeom: Geom = { rects: [], connectors: [] };
  data.trunk.forEach((s, i) => {
    const w = Math.max((s.value / trunkFirst) * maxW, 4);
    trunkGeom.rects.push({
      x: alignX(pad, maxW, w),
      y: legendSpace + i * (trunkBarH + gap),
      w,
      h: trunkBarH,
      fill: style.trunkFill,
      label: barLabel(
        s,
        {
          previous: i === 0 ? s.value : data.trunk[i - 1].value,
          container: trunkFirst,
          e2e: trunkFirst,
        },
        style.valueDisplay,
        style.percentBasis,
      ),
      labelColor: style.trunkText,
      labelAlign: style.barAlignment,
      meta: { step: s.name },
    });
    if (leak && leak.branch === null && leak.toIndex === i) {
      const prevW = Math.max((data.trunk[i - 1].value / trunkFirst) * maxW, 4);
      const r = trunkGeom.rects[trunkGeom.rects.length - 1];
      r.leak = {
        drop: leak.drop,
        lostW: Math.max(prevW - w, 0),
        badgeDX: pad + maxW - r.x,
      };
    }
  });

  const trunkBottom = legendSpace + data.trunk.length * (trunkBarH + gap);
  const branchTop = trunkBottom + (data.trunk.length ? connectorH : 0);
  const trunkLast = data.trunk[data.trunk.length - 1];
  const splitBase =
    trunkLast?.value ??
    Object.values(data.branches).reduce(
      (acc, s) => acc + (s[0]?.value ?? 0),
      0,
    );

  const shown = visible.filter(b => data.branches[b]?.length);
  const n = shown.length || 1;
  const colW = (maxW - (n - 1) * colGap) / n;

  const branchGeoms: Record<string, Geom> = {};
  const colBottoms: Record<string, number> = {};
  if (!collapsed) shown.forEach((b, j) => {
    const allSteps = data.branches[b];
    const steps = mergeName ? allSteps.slice(0, -1) : allSteps;
    const entry = allSteps[0]?.value || 1;
    const x0 = pad + j * (colW + colGap);
    const g: Geom = { rects: [], connectors: [] };
    const share = splitBase > 0 ? entry / splitBase : NaN;
    g.rects.push({
      x: x0,
      y: branchTop,
      w: colW,
      h: headerH,
      fill: style.branchColors[b],
      label: `${b} · ${pctFmt(share)}`,
      labelColor: style.barText,
      bold: true,
      meta: { branch: b },
    });
    steps.forEach((s, k) => {
      const w = Math.max((s.value / entry) * colW, 4);
      g.rects.push({
        x: alignX(x0, colW, w),
        y: branchTop + headerH + 8 + k * (branchBarH + branchGap),
        w,
        h: branchBarH,
        fill: style.branchColors[b],
        label: barLabel(
          s,
          {
            previous:
              k === 0 ? (trunkLast?.value ?? s.value) : steps[k - 1].value,
            container: entry,
            e2e: trunkRef || entry,
          },
          style.valueDisplay,
          style.percentBasis,
        ),
        labelColor: style.barText,
        labelAlign: style.barAlignment,
        meta: { branch: b, step: s.name },
      });
      if (leak && leak.branch === b && leak.toIndex === k) {
        const prevW = Math.max((steps[k - 1].value / entry) * colW, 4);
        const r = g.rects[g.rects.length - 1];
        r.leak = {
          drop: leak.drop,
          lostW: Math.max(prevW - w, 0),
          badgeDX: x0 + colW - r.x,
        };
      }
    });
    colBottoms[b] =
      branchTop + headerH + 8 + steps.length * (branchBarH + branchGap) - branchGap;
    if (trunkLast) {
      const lastRect = trunkGeom.rects[trunkGeom.rects.length - 1];
      const colCenter = x0 + colW / 2;
      const srcX = Math.min(
        Math.max(colCenter, lastRect.x + 10),
        lastRect.x + lastRect.w - 10,
      );
      g.connectors.push({
        x1: srcX,
        y1: trunkBottom - gap + 2,
        x2: colCenter,
        y2: branchTop - 3,
        color: style.branchColors[b],
      });
    }
    branchGeoms[b] = g;
  });

  // --- слияние общего финального шага в сегментированный итоговый бар ---
  if (mergeName && shown.length) {
    const finals = shown.map(b => {
      const s = data.branches[b];
      return s[s.length - 1].value;
    });
    /** подпись сегмента: уважает value display и базисы; имя ветки — только
     *  в свёрнутом виде (в развёрнутом её называет заголовок колонки) */
    const segLabel = (b: string, v: number): string => {
      const allSteps = data.branches[b];
      const entry = allSteps[0]?.value || 1;
      const prev =
        allSteps.length >= 2 ? allSteps[allSteps.length - 2].value : entry;
      const full = barLabel(
        { name: collapsed && !sparkline ? b : '', order: 0, value: v },
        { previous: prev, container: entry, e2e: trunkRef || entry },
        style.valueDisplay,
        style.percentBasis,
      );
      return collapsed && !sparkline ? full : full.replace(/^ · /, '');
    };
    const total = finals.reduce((a, v) => a + v, 0) || 1;
    const colsBottom = collapsed
      ? trunkBottom - gap
      : Math.max(...shown.map(b => colBottoms[b]));
    const mergeTop = colsBottom + (sparkline ? 8 : compact ? 24 : 30);
    const lastTrunkRect = trunkGeom.rects[trunkGeom.rects.length - 1];
    // в спарклайне финальный шаг — обычный шаг воронки: ширина по шкале ствола
    // (не на всю ячейку), сегменты внутри — по долям веток, чтобы воронка сужалась
    const mergeBarW = sparkline ? Math.max((total / trunkFirst) * maxW, 24) : maxW;
    const mergeX0 = sparkline ? alignX(pad, maxW, mergeBarW) : pad;
    const mergeEnd = mergeX0 + mergeBarW;
    let cx = mergeX0;
    shown.forEach((b, j) => {
      const v = finals[j];
      const w =
        j === shown.length - 1
          ? mergeEnd - cx
          : Math.max((v / total) * mergeBarW, sparkline ? 2 : 4);
      const g = collapsed
        ? (branchGeoms[b] = branchGeoms[b] ?? { rects: [], connectors: [] })
        : branchGeoms[b];
      g.rects.push({
        x: cx,
        y: mergeTop,
        w,
        h: mh,
        fill: style.branchColors[b],
        label: segLabel(b, v),
        labelColor: style.barText,
        meta: { branch: b, step: mergeName },
      });
      // в свёрнутой ячейке (или если худший провал — на финальном шаге)
      // вешаем бейдж на сегмент успеха этой ветки
      const allStepsB = data.branches[b];
      if (
        leak &&
        leak.branch === b &&
        (collapsed || leak.toIndex === allStepsB.length - 1)
      ) {
        const segR = g.rects[g.rects.length - 1];
        segR.leak = { drop: leak.drop, lostW: 0, badgeDX: mergeEnd - segR.x };
      }
      const segCx = cx + w / 2;
      // в спарклайне стрелок нет — ствол перетекает прямо в бар успеха
      if (!sparkline) {
        g.connectors.push(
          collapsed && lastTrunkRect
            ? {
                x1: Math.min(
                  Math.max(segCx, lastTrunkRect.x + 10),
                  lastTrunkRect.x + lastTrunkRect.w - 10,
                ),
                y1: colsBottom + 2,
                x2: segCx,
                y2: mergeTop - 3,
                color: style.branchColors[b],
              }
            : {
                x1: pad + j * (colW + colGap) + colW / 2,
                y1: colBottoms[b] + 2,
                x2: segCx,
                y2: mergeTop - 3,
                color: style.branchColors[b],
              },
        );
      }
      cx += w;
    });
    // в спарклайне итог не дублируем баром — total + E2E уходят в заголовок ячейки
    if (!sparkline) {
      const ofSplit = splitBase > 0 ? total / splitBase : NaN;
      const e2e = trunkRef > 0 ? total / trunkRef : NaN;
      trunkGeom.rects.push({
        x: pad,
        y: mergeTop + mh + 8,
        w: maxW,
        h: mh,
        fill: style.trunkFill,
        label: `${mergeName} · ${numFmt(total)} · ${pctFmt(ofSplit)} of split · ${pctFmt(e2e)} E2E`,
        labelColor: style.trunkText,
        bold: true,
        meta: { step: mergeName },
      });
    }
  }

  // --- пиктограмма схлопывания на развилке -------------------------------
  let toggle: { x: number; y: number } | null = null;
  if (style.collapsible && mergeName && data.trunk.length) {
    const lastRect = trunkGeom.rects[data.trunk.length - 1];
    const rightX = lastRect.x + lastRect.w + 18;
    const x =
      rightX <= pad + maxW - 2
        ? rightX
        : Math.max(lastRect.x - 18, pad + 12);
    toggle = { x, y: lastRect.y + lastRect.h / 2 };
  }

  return { trunk: trunkGeom, branches: branchGeoms, toggle };
}

function geomToChildren(g: Geom, fz = 12): Record<string, any>[] {
  const children: Record<string, any>[] = [];
  (g.texts ?? []).forEach(t => {
    children.push({
      type: 'text',
      style: {
        x: t.x,
        y: t.y,
        text: t.text,
        fill: t.color,
        fontSize: fz - 1,
        fontWeight: 600,
        verticalAlign: 'middle',
      },
    });
  });
  g.connectors.forEach(c => {
    const bend = Math.max((c.y2 - c.y1) * 0.6, 8);
    children.push({
      type: 'bezierCurve',
      shape: {
        x1: c.x1,
        y1: c.y1,
        x2: c.x2,
        y2: c.y2,
        cpx1: c.x1,
        cpy1: c.y1 + bend,
        cpx2: c.x2,
        cpy2: c.y2 - bend,
      },
      style: {
        stroke: c.color,
        fill: 'none',
        lineWidth: 2,
        opacity: 0.55,
      },
    });
  });
  g.rects.forEach(r => {
    children.push({
      type: 'rect',
      shape: { x: r.x, y: r.y, width: r.w, height: r.h, r: 4 },
      style: { fill: r.fill },
    });
    const align = r.labelAlign ?? 'left';
    const tx =
      align === 'center'
        ? r.x + r.w / 2
        : align === 'right'
          ? r.x + r.w - 10
          : r.x + 10;
    children.push({
      type: 'text',
      style: {
        x: tx,
        y: r.y + r.h / 2,
        text: r.label,
        fill: r.labelColor,
        fontSize: fz,
        fontWeight: r.bold ? 600 : 400,
        align,
        verticalAlign: 'middle',
        overflow: 'truncate',
        width: Math.max(r.w - 16, 24),
      },
    });
    if (r.leak) {
      const lc = '#E8973A';
      const lalign = r.labelAlign ?? 'left';
      // блок выпавшего объёма рисуем только при левом выравнивании (иначе
      // геометрия потери неоднозначна) — для остальных только бейдж
      if (lalign === 'left' && r.leak.lostW > 2) {
        children.push({
          type: 'rect',
          shape: { x: r.x + r.w, y: r.y, width: r.leak.lostW, height: r.h, r: 2 },
          style: { fill: 'rgba(232,151,58,0.22)' },
        });
      }
      const bw = 46;
      const bh = 16;
      const bxRight = r.x + r.leak.badgeDX;
      const byc = r.y + r.h / 2;
      children.push({
        type: 'rect',
        shape: { x: bxRight - bw, y: byc - bh / 2, width: bw, height: bh, r: 8 },
        style: { fill: 'rgba(232,151,58,0.16)', stroke: lc, lineWidth: 0.75 },
      });
      children.push({
        type: 'text',
        style: {
          x: bxRight - bw / 2,
          y: byc,
          text: `▼ ${Math.round(r.leak.drop * 100)}%`,
          fill: lc,
          fontSize: fz - 1,
          fontWeight: 600,
          align: 'center',
          verticalAlign: 'middle',
        },
      });
    }
  });
  return children;
}

function branchTooltip(steps: FunnelStep[], name: string): string {
  const entry = steps[0]?.value || 0;
  const rows = steps
    .map(
      s =>
        `<div style="display:flex;gap:14px;line-height:1.7"><span>${s.name}</span>` +
        `<span style="margin-left:auto;font-weight:600">${numFmt(s.value)}` +
        ` (${pctFmt(entry ? s.value / entry : NaN)})</span></div>`,
    )
    .join('');
  return `<div style="font-weight:600;margin-bottom:4px">${name}</div>${rows}`;
}

function buildFacetSeries(
  facet: { name: string | null; data: SplitFunnelData },
  idx: number,
  style: SplitFunnelStyle,
  cellW: number,
  dx: number,
  dy: number,
  visible: string[],
  collapsed: boolean,
  facetMode: boolean,
): {
  series: Record<string, any>[];
  bottom: number;
  toggle: boolean;
  hitRects: HitRect[];
} {
  const { data } = facet;
  const mergeName = style.mergeFinalStep ? detectCommonFinal(data) : null;
  // в сетке compact = свёрнутый спарклайн (если есть общий финал для слияния)
  const compactCell = facetMode && style.gridCellDetail === 'compact';
  const wantCollapsed = facetMode ? compactCell : collapsed;
  const isCollapsed = wantCollapsed && !!mergeName;
  const sparkline = compactCell && isCollapsed;
  const cellStyle = facetMode ? { ...style, collapsible: false } : style;
  const visibleF = visible.filter(b => data.branches[b]);
  const leak = style.highlightDrop
    ? detectLeak(data, style.dropThreshold, visibleF)
    : null;
  const layout0 = computeLayout(data, cellStyle, cellW, visibleF, mergeName, isCollapsed, leak, {
    compact: facetMode,
    topPad: facetMode ? (facet.name !== null ? 24 : 8) : undefined,
    sparkline,
  });
  if (facetMode && facet.name !== null) {
    const trunkFirst = data.trunk[0]?.value ?? 0;
    let title = facet.name;
    if (mergeName && trunkFirst > 0) {
      const total = Object.keys(data.branches)
        .filter(b => visibleF.includes(b))
        .reduce((acc, b) => {
          const s = data.branches[b];
          return acc + (s[s.length - 1]?.value ?? 0);
        }, 0);
      // в спарклайне заголовок несёт и абсолют, и E2E (отдельного итог-бара нет)
      title += sparkline
        ? ` · ${numFmt(total)} · ${pctFmt(total / trunkFirst)} E2E`
        : ` · ${pctFmt(total / trunkFirst)} E2E`;
    }
    layout0.trunk.texts = [
      { x: 10, y: 12, text: title, color: style.mutedText },
    ];
  }
  const shiftedBranches: Record<string, Geom> = {};
  Object.entries(layout0.branches).forEach(([b, g]) => {
    shiftedBranches[b] = shiftGeom(g, dx, dy);
  });
  const layout = {
    trunk: shiftGeom(layout0.trunk, dx, dy),
    branches: shiftedBranches,
    toggle:
      layout0.toggle && !facetMode
        ? { x: layout0.toggle.x + dx, y: layout0.toggle.y + dy }
        : null,
  };
  const fz = facetMode ? 11 : 12;
  const hitRects: HitRect[] = [];
  const collectHits = (g: Geom) =>
    g.rects.forEach(r => {
      if (r.meta)
        hitRects.push({
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          meta: { ...r.meta, facet: facet.name },
        });
    });
  collectHits(layout.trunk);
  Object.values(layout.branches).forEach(collectHits);
  const series: Record<string, any>[] = [
    {
      name: `__trunk_${idx}`,
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      renderItem: () => ({ type: 'group', children: geomToChildren(layout.trunk, fz) }),
      tooltip: {
        formatter: () =>
          branchTooltip(
            data.trunk,
            facet.name ? `Общий поток — ${facet.name}` : 'Общий поток',
          ),
      },
    },
    ...Object.keys(data.branches).map(b => ({
      name: b,
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      itemStyle: { color: style.branchColors[b] },
      renderItem: () =>
        layout.branches[b]
          ? { type: 'group', children: geomToChildren(layout.branches[b], fz) }
          : { type: 'group', children: [] },
      tooltip: {
        formatter: () =>
          branchTooltip(data.branches[b], facet.name ? `${b} — ${facet.name}` : b),
      },
    })),
  ];
  if (layout.toggle) {
    const { x, y } = layout.toggle;
    series.push({
      name: '__toggle',
      type: 'custom',
      coordinateSystem: 'none',
      cursor: 'pointer',
      data: [0],
      silent: false,
      tooltip: {
        formatter: () =>
          isCollapsed
            ? 'Развернуть ветки'
            : 'Свернуть ветки',
      },
      renderItem: () => ({
        type: 'group',
        children: [
          {
            type: 'circle',
            shape: { cx: x, cy: y, r: 10 },
            style: { fill: style.trunkFill, opacity: 0.95 },
          },
          {
            type: 'text',
            style: {
              x,
              y: y + 0.5,
              text: isCollapsed ? '+' : '−',
              fill: style.trunkText,
              fontSize: 14,
              fontWeight: 600,
              align: 'center',
              verticalAlign: 'middle',
            },
          },
        ],
      }),
    });
  }
  return { series, bottom: geomBottom(layout), toggle: !!layout.toggle, hitRects };
}

function buildOption(
  facets: { name: string | null; data: SplitFunnelData }[],
  style: SplitFunnelStyle,
  width: number,
  selected?: Record<string, boolean>,
  collapsed = false,
) {
  // Ð¾Ð±ÑÐµÐ´Ð¸Ð½ÑÐ½Ð½ÑÐ¹ ÑÐ¿Ð¸ÑÐ¾Ðº Ð²ÐµÑÐ¾Ðº Ð¿Ð¾ Ð²ÑÐµÐ¼ ÑÐ°ÑÐµÑÐ°Ð¼ â Ð¾Ð±ÑÐ°Ñ Ð»ÐµÐ³ÐµÐ½Ð´Ð°
  const branchTotals: Record<string, number> = {};
  facets.forEach(f =>
    Object.entries(f.data.branches).forEach(([b, steps]) => {
      branchTotals[b] = (branchTotals[b] ?? 0) + (steps[0]?.value ?? 0);
    }),
  );
  const allBranches = Object.keys(branchTotals).sort(
    (a, b) => branchTotals[b] - branchTotals[a],
  );
  const visible = allBranches.filter(b => !selected || selected[b] !== false);

  const facetMode = facets.length > 1 || facets[0]?.name !== null;
  const cols = facetMode
    ? Math.max(1, Math.min(facets.length, Math.floor(width / 360)))
    : 1;
  const gapX = 16;
  const gapY = 14;
  const cellW = (width - (cols - 1) * gapX) / cols;
  const legendTop = facetMode && style.showLegend ? 30 : 0;

  const series: Record<string, any>[] = [];
  const hitRects: HitRect[] = [];
  let rowY = legendTop;
  let rowBottom = legendTop;
  facets.forEach((facet, idx) => {
    const col = idx % cols;
    if (col === 0 && idx > 0) {
      rowY = rowBottom + gapY;
    }
    const dx = col * (cellW + gapX);
    const r = buildFacetSeries(
      facet,
      idx,
      style,
      cellW,
      dx,
      rowY,
      visible,
      collapsed,
      facetMode,
    );
    series.push(...r.series);
    hitRects.push(...r.hitRects);
    rowBottom = Math.max(rowBottom, r.bottom);
  });

  return {
    option: {
      legend: {
        show: style.showLegend,
        top: 0,
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
        data: allBranches,
        textStyle: { color: style.mutedText, fontSize: 12 },
        ...(selected ? { selected } : {}),
      },
      tooltip: { trigger: 'item' as const, confine: true },
      series,
    },
    hitRects,
  };
}

export default function SplitFunnelChart(props: SplitFunnelChartProps) {
  const { facets, style, width, height, columns, onContextMenu } = props;
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType>();
  const selectedRef = useRef<Record<string, boolean> | undefined>(undefined);
  const collapsedRef = useRef<boolean>(style.startCollapsed);
  const hitRectsRef = useRef<HitRect[]>([]);
  const propsRef = useRef({ facets, style, width, columns, onContextMenu });
  propsRef.current = { facets, style, width, columns, onContextMenu };

  useEffect(() => {
    if (!divRef.current) return;
    const apply = () => {
      const p = propsRef.current;
      const r = buildOption(
        p.facets,
        p.style,
        p.width,
        selectedRef.current,
        collapsedRef.current,
      );
      hitRectsRef.current = r.hitRects;
      chartRef.current?.setOption(r.option, { replaceMerge: ['series'] });
    };
    if (!chartRef.current) {
      chartRef.current = init(divRef.current);
      chartRef.current.on('legendselectchanged', (params: any) => {
        selectedRef.current = { ...params.selected };
        apply();
      });
      chartRef.current.on('click', (params: any) => {
        if (params.seriesName === '__toggle') {
          collapsedRef.current = !collapsedRef.current;
          apply();
        }
      });
      // Drill to Detail: правый клик по конкретному бару -> контекстное
      // меню Superset с фильтрами шаг/ветка/фасет (hit-test по геометрии)
      chartRef.current.on('contextmenu', (params: any) => {
        const p = propsRef.current;
        if (!p.onContextMenu) return;
        const ev = params?.event;
        const native = ev?.event as MouseEvent | undefined;
        if (!native) return;
        const ox = ev.offsetX;
        const oy = ev.offsetY;
        const hit = [...hitRectsRef.current]
          .reverse()
          .find(
            r => ox >= r.x && ox <= r.x + r.w && oy >= r.y && oy <= r.y + r.h,
          );
        if (!hit) return;
        native.preventDefault();
        native.stopPropagation();
        const filters: Record<string, unknown>[] = [];
        if (hit.meta.step && p.columns.step) {
          filters.push({
            col: p.columns.step,
            op: '==',
            val: hit.meta.step,
            formattedVal: hit.meta.step,
          });
        }
        if (hit.meta.branch && p.columns.branch) {
          filters.push({
            col: p.columns.branch,
            op: '==',
            val: hit.meta.branch,
            formattedVal: hit.meta.branch,
          });
        }
        if (hit.meta.facet != null && p.columns.facet) {
          filters.push({
            col: p.columns.facet,
            op: '==',
            val: hit.meta.facet,
            formattedVal: hit.meta.facet,
          });
        }
        p.onContextMenu(native.clientX, native.clientY, {
          drillToDetail: filters,
        });
      });
    }
    apply();
  }, [facets, style, width]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = undefined;
    },
    [],
  );

  useLayoutEffect(() => {
    chartRef.current?.resize({ width, height });
    const r = buildOption(
      facets,
      style,
      width,
      selectedRef.current,
      collapsedRef.current,
    );
    hitRectsRef.current = r.hitRects;
    chartRef.current?.setOption(r.option, { replaceMerge: ['series'] });
  }, [width, height, facets, style]);

  return <Styles ref={divRef} height={height} width={width} />;
}
