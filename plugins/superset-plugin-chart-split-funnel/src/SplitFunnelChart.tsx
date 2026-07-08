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
  overflow-x: hidden;
  overflow-y: auto;
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
  subbranch?: string;
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
    /** явная ширина метки (для узких баров/сегментов — берём по колонке) */
    labelWidth?: number;
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

/** вход в контейнер (значение первого шага ствола, либо сумма входов веток) */
function containerEntry(d: SplitFunnelData): number {
  if (d.trunk.length) return d.trunk[0].value;
  return Object.values(d.branches).reduce((a, b) => a + containerEntry(b), 0);
}

/** финальный сегмент контейнера: имя и значение, к которому он сходится.
 *  Лист → последний шаг ствола. Контейнер с ветками → общий финал (рекурсивно),
 *  значение = сумма финалов веток. */
function containerFinal(d: SplitFunnelData): { name: string | null; value: number } {
  const names = Object.keys(d.branches);
  if (names.length === 0) {
    const last = d.trunk[d.trunk.length - 1];
    return { name: last?.name ?? null, value: last?.value ?? 0 };
  }
  const finals = names.map(b => containerFinal(d.branches[b]));
  const common =
    finals.length >= 1 && finals.every(f => f.name && f.name === finals[0].name)
      ? finals[0].name
      : null;
  return { name: common, value: finals.reduce((a, f) => a + f.value, 0) };
}

/** все финалы листьев контейнера (рекурсивно): имя последнего шага + значение */
function leafFinals(d: SplitFunnelData): { name: string | null; value: number }[] {
  const names = Object.keys(d.branches);
  if (names.length === 0) {
    const last = d.trunk[d.trunk.length - 1];
    return [{ name: last?.name ?? null, value: last?.value ?? 0 }];
  }
  return names.flatMap(b => leafFinals(d.branches[b]));
}

/** значение контейнера НА заданном финальном шаге (0, если лист до него не дошёл).
 *  Позволяет мержить, даже когда часть под-веток обрывается раньше общего финала. */
function finalValueAt(d: SplitFunnelData, name: string): number {
  const names = Object.keys(d.branches);
  if (names.length === 0) {
    const last = d.trunk[d.trunk.length - 1];
    return last && last.name === name ? last.value : 0;
  }
  return names.reduce((a, b) => a + finalValueAt(d.branches[b], name), 0);
}

/** имя финального шага для слияния — ДОМИНИРУЮЩЕЕ среди листьев (мода).
 *  Терпимо к тому, что отдельная под-ветка обрывается раньше общего финала: такая
 *  ветка даст 0 в merge (через finalValueAt), а НЕ обнулит весь merge, как раньше.
 *  null, если развилки нет либо явного (встречающегося ≥2 раз) финала нет. */
function detectCommonFinal(data: SplitFunnelData): string | null {
  const names = Object.keys(data.branches);
  if (names.length < 2) return null;
  const counts = new Map<string, number>();
  leafFinals(data).forEach(f => {
    if (f.name) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
  });
  let best: string | null = null;
  let bestN = 0;
  counts.forEach((n, name) => {
    if (n > bestN) {
      bestN = n;
      best = name;
    }
  });
  if (best === null) return null;
  // нужен минимальный консенсус: финал встречается ≥2 раз либо он единственный
  if (bestN < 2 && counts.size > 1) return null;
  return best;
}

/** худший провал конверсии: шаг-к-шагу по стволу и внутри веток.
 *  Дробление на ветки (ствол → вход в ветку) утечкой НЕ считается. */
export interface Leak {
  /** null = переход внутри ствола, иначе имя ветки */
  branch: string | null;
  /** имя подветки, если утечка внутри подветки (иначе undefined) */
  subbranch?: string;
  /** индекс шага-приёмника (в стволе или в полном списке шагов ветки/подветки) */
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
    subbranch: string | undefined,
    toIndex: number,
    toStep: string,
    fromValue: number,
    toValue: number,
  ) => {
    if (fromValue <= 0 || toValue < 0) return;
    const drop = 1 - toValue / fromValue;
    if (drop > 0) cands.push({ branch, subbranch, toIndex, toStep, drop });
  };
  for (let i = 1; i < data.trunk.length; i += 1) {
    consider(
      null,
      undefined,
      i,
      data.trunk[i].name,
      data.trunk[i - 1].value,
      data.trunk[i].value,
    );
  }
  Object.entries(data.branches).forEach(([b, bd]) => {
    if (!visible.includes(b)) return;
    const steps = bd.trunk;
    for (let k = 1; k < steps.length; k += 1) {
      consider(b, undefined, k, steps[k].name, steps[k - 1].value, steps[k].value);
    }
    // подветки: провал шаг-к-шагу внутри каждой подветки
    Object.entries(bd.branches).forEach(([s, sd]) => {
      if (!visible.includes(s)) return;
      const sSteps = sd.trunk;
      for (let k = 1; k < sSteps.length; k += 1) {
        consider(
          b,
          s,
          k,
          sSteps[k].name,
          sSteps[k - 1].value,
          sSteps[k].value,
        );
      }
    });
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
  collapsedSubs: Record<string, boolean> = {},
): {
  trunk: Geom;
  branches: Record<string, Geom>;
  subGeoms: Record<
    string,
    {
      geom: Geom;
      title: string;
      steps: FunnelStep[];
      color: string;
      entryV: number;
      prevFirst: number;
      e2eRef: number;
    }
  >;
  toggles: { key: string; x: number; y: number; collapsed: boolean }[];
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
    Object.values(data.branches).reduce((acc, s) => acc + containerEntry(s), 0);

  const shown = visible.filter(b => {
    const bd = data.branches[b];
    return bd && (bd.trunk.length > 0 || Object.keys(bd.branches).length > 0);
  });
  const n = shown.length || 1;
  const colW = (maxW - (n - 1) * colGap) / n;

  // геомы под-веток — отдельными сериями (у каждой под-ветки свой тултип)
  const subGeomsOut: Record<
    string,
    {
      geom: Geom;
      title: string;
      steps: FunnelStep[];
      color: string;
      entryV: number;
      prevFirst: number;
      e2eRef: number;
    }
  > = {};
  // пиктограммы сворачивания: верхняя развилка (key='__top') + под-развилки (key=имя ветки)
  const togglesOut: { key: string; x: number; y: number; collapsed: boolean }[] =
    [];

  // --- рекурсивный рендер под-сплита (2-й уровень) внутри колонки ветки -----
  // рисует под-ветки контейнера как под-колонки + их слияние, возвращает нижний Y.
  const renderSubSplit = (
    g: Geom,
    container: SplitFunnelData,
    parentBranch: string,
    x0: number,
    cw: number,
    top: number,
  ): number => {
    const subMerge = style.mergeFinalStep ? detectCommonFinal(container) : null;
    const subCols = Object.keys(container.branches).filter(s => {
      if (!visible.includes(s)) return false;
      const sd = container.branches[s];
      return sd.trunk.length > 0 || Object.keys(sd.branches).length > 0;
    });
    if (!subCols.length) return top;
    const parentColor = style.branchColors[parentBranch];
    const subGap = 8;
    const nn = subCols.length;
    const subW = (cw - (nn - 1) * subGap) / nn;
    const subHeaderH = Math.max(headerH - 6, 15);
    const subBarH = Math.max(branchBarH - 3, 14);
    const subEntry = containerEntry(container) || 1;
    // точка разветвления = последний шаг ствола ветки (напр. «Аккаунт создан»).
    // От неё считаются доли/конверсии под-веток (а не от первого шага ветки).
    const parentSplitV =
      (container.trunk.length
        ? container.trunk[container.trunk.length - 1].value
        : subEntry) || 1;
    const finals = subCols.map(s =>
      subMerge
        ? finalValueAt(container.branches[s], subMerge)
        : containerFinal(container.branches[s]).value,
    );
    const collapsedHere = !!collapsedSubs[parentBranch];
    if (style.collapsible && subMerge) {
      togglesOut.push({
        key: parentBranch,
        x: x0 + cw / 2,
        y: top - 6,
        collapsed: collapsedHere,
      });
    }
    const bottoms: number[] = [];
    // геом каждой под-ветки — чтобы сегмент под-merge попал в ЕЁ серию (свой тултип)
    const subSg: Record<string, Geom> = {};
    if (!collapsedHere) subCols.forEach((s, j) => {
      const sd = container.branches[s];
      const sAll = sd.trunk;
      const sSteps = subMerge ? sAll.slice(0, -1) : sAll;
      const sEntryV = containerEntry(sd) || 1;
      const sx = x0 + j * (subW + subGap);
      const color = style.branchColors[s] ?? parentColor;
      // под-ветку рисуем в СВОЙ геом (отдельная серия -> собственный тултип)
      const sg: Geom = { rects: [], connectors: [] };
      subSg[s] = sg;
      subGeomsOut[`${parentBranch} ${s}`] = {
        geom: sg,
        title: `${parentBranch} / ${s}`,
        steps: sd.trunk,
        color,
        entryV: sEntryV,
        prevFirst: parentSplitV,
        e2eRef: trunkRef || sEntryV,
      };
      sg.rects.push({
        x: sx,
        y: top,
        w: subW,
        h: subHeaderH,
        fill: color,
        label: `${s} · ${pctFmt(parentSplitV > 0 ? sEntryV / parentSplitV : NaN)}`,
        labelColor: style.barText,
        bold: true,
        meta: { branch: parentBranch, subbranch: s },
      });
      sSteps.forEach((st, k) => {
        const w = Math.max((st.value / sEntryV) * subW, 4);
        sg.rects.push({
          x: alignX(sx, subW, w),
          y: top + subHeaderH + 6 + k * (subBarH + branchGap),
          w,
          h: subBarH,
          fill: color,
          label: barLabel(
            st,
            {
              previous: k === 0 ? parentSplitV : sSteps[k - 1].value,
              container: sEntryV,
              e2e: trunkRef || sEntryV,
            },
            style.valueDisplay,
            style.percentBasis,
          ),
          labelColor: style.barText,
          labelAlign: style.barAlignment,
          labelWidth: Math.max(subW - 12, 24),
          meta: { branch: parentBranch, subbranch: s, step: st.name },
        });
        if (
          leak &&
          leak.branch === parentBranch &&
          leak.subbranch === s &&
          leak.toIndex === k
        ) {
          const prevW = Math.max((sSteps[k - 1].value / sEntryV) * subW, 4);
          const r = sg.rects[sg.rects.length - 1];
          r.leak = {
            drop: leak.drop,
            lostW: Math.max(prevW - w, 0),
            badgeDX: sx + subW - r.x,
          };
        }
      });
      bottoms.push(
        top + subHeaderH + 6 + sSteps.length * (subBarH + branchGap) - branchGap,
      );
      g.connectors.push({
        x1: x0 + cw / 2,
        y1: top - 4,
        x2: sx + subW / 2,
        y2: top - 1,
        color,
      });
    });
    if (!subMerge) return collapsedHere ? top : Math.max(...bottoms);
    // сегментированный под-merge: свёрнуто — сразу под стволом ветки, иначе — под колонками
    const total = finals.reduce((a, v) => a + v, 0) || 1;
    const mt = collapsedHere ? top + 2 : Math.max(...bottoms) + 18;
    const mhh = Math.max(mh - 4, 16);
    let cx = x0;
    subCols.forEach((s, j) => {
      const v = finals[j];
      const w =
        j === subCols.length - 1 ? x0 + cw - cx : Math.max((v / total) * cw, 4);
      const color = style.branchColors[s] ?? parentColor;
      // бейдж утечки на сегменте под-merge: свёрнуто — любой внутренний провал
      // под-ветки, развёрнуто — только если худший провал на финальном шаге
      const subLeakHit =
        !!leak &&
        leak.branch === parentBranch &&
        leak.subbranch === s &&
        (collapsedHere ||
          leak.toIndex === container.branches[s].trunk.length - 1);
      // #3 доля от точки разветвления; #2 узкие сегменты без подписи (уходят в тултип)
      // подпись = barLabel сегмента от ВХОДА под-ветки (как у ветки → консистентно;
      // «без подтверждения» = 100%). Узкие сегменты без подписи (детали в тултипе).
      const sEntryS = containerEntry(container.branches[s]) || 1;
      const subAllS = container.branches[s].trunk;
      const subPrevS =
        subAllS.length >= 2 ? subAllS[subAllS.length - 2].value : sEntryS;
      const segFull = barLabel(
        { name: '', order: 0, value: v },
        { previous: subPrevS, container: sEntryS, e2e: trunkRef || sEntryS },
        style.valueDisplay,
        style.percentBasis,
      ).replace(/^ · /, '');
      const segLabelExp = w >= 88 ? segFull : w >= 48 ? numFmt(v) : '';
      const seg = {
        x: cx,
        y: mt,
        w,
        h: mhh,
        fill: color,
        // свёрнуто: имя под-ветки + значение + доля (колонок-заголовков уже нет);
        // развёрнуто: только значение (имя есть на заголовке под-колонки выше)
        label: collapsedHere
          ? `${s} · ${numFmt(v)} · ${pctFmt(total > 0 ? v / total : NaN)}`
          : segLabelExp,
        labelColor: style.barText,
        labelWidth: Math.max(w - 8, 18),
        meta: { branch: parentBranch, subbranch: s, step: subMerge },
        ...(subLeakHit && leak
          ? { leak: { drop: leak.drop, lostW: 0, badgeDX: w } }
          : {}),
      };
      if (collapsedHere) {
        // свёрнутый сегмент под-ветки — своя серия со своим тултипом (шаги под-ветки)
        subGeomsOut[`${parentBranch} ${s}`] = {
          geom: { rects: [seg], connectors: [] },
          title: `${parentBranch} / ${s}`,
          steps: container.branches[s].trunk,
          color,
          entryV: containerEntry(container.branches[s]) || 1,
          prevFirst: parentSplitV,
          e2eRef: trunkRef || parentSplitV,
        };
      } else {
        // сегмент под-merge кладём в серию под-ветки (её тултип), не в серию ветки
        (subSg[s] ?? g).rects.push(seg);
      }
      g.connectors.push(
        collapsedHere
          ? { x1: x0 + cw / 2, y1: top - 4, x2: cx + w / 2, y2: mt - 3, color }
          : {
              x1: x0 + j * (subW + subGap) + subW / 2,
              y1: bottoms[j] + 2,
              x2: cx + w / 2,
              y2: mt - 3,
              color,
            },
      );
      cx += w;
    });
    // подпись под-merge не рисуем (дублирует сегментированный бар и ствол-merge)
    return mt + mhh;
  };

  const branchGeoms: Record<string, Geom> = {};
  const colBottoms: Record<string, number> = {};
  if (!collapsed) shown.forEach((b, j) => {
    const bd = data.branches[b];
    const hasSub = Object.keys(bd.branches).length > 0;
    const allSteps = bd.trunk;
    // лист: финальный шаг сливает родитель -> отрезаем; вложенная ветка: ствол целиком
    const steps = mergeName && !hasSub ? allSteps.slice(0, -1) : allSteps;
    const entry = containerEntry(bd) || 1;
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
      if (leak && leak.branch === b && !leak.subbranch && leak.toIndex === k) {
        const prevW = Math.max((steps[k - 1].value / entry) * colW, 4);
        const r = g.rects[g.rects.length - 1];
        r.leak = {
          drop: leak.drop,
          lostW: Math.max(prevW - w, 0),
          badgeDX: x0 + colW - r.x,
        };
      }
    });
    let colBottom =
      branchTop + headerH + 8 + steps.length * (branchBarH + branchGap) - branchGap;
    if (hasSub) {
      colBottom = renderSubSplit(g, bd, b, x0, colW, colBottom + 14);
    }
    colBottoms[b] = colBottom;
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
    const finals = shown.map(b => finalValueAt(data.branches[b], mergeName));
    /** подпись сегмента: уважает value display и базисы; имя ветки — только
     *  в свёрнутом виде (в развёрнутом её называет заголовок колонки) */
    const segLabel = (b: string, v: number): string => {
      const allSteps = data.branches[b].trunk;
      const entry = containerEntry(data.branches[b]) || 1;
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
      const allStepsB = data.branches[b].trunk;
      if (
        leak &&
        leak.branch === b &&
        !leak.subbranch &&
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

  // --- пиктограмма схлопывания верхней развилки --------------------------
  // (по центру, в зазоре между стволом и ветками — НЕ поверх бара)
  if (style.collapsible && mergeName && data.trunk.length) {
    togglesOut.push({
      key: '__top',
      x: pad + maxW / 2,
      y: trunkBottom + 12,
      collapsed,
    });
  }

  return {
    trunk: trunkGeom,
    branches: branchGeoms,
    subGeoms: subGeomsOut,
    toggles: togglesOut,
  };
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
        width: r.labelWidth ?? Math.max(r.w - 16, 24),
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

/** плоский список шагов ветки для тултипа (ствол ветки + её под-ветки с префиксом) */
function branchTooltipSteps(d: SplitFunnelData): FunnelStep[] {
  if (!Object.keys(d.branches).length) return d.trunk;
  const out: FunnelStep[] = [...d.trunk];
  Object.entries(d.branches).forEach(([s, sd]) => {
    branchTooltipSteps(sd).forEach(st =>
      out.push({ ...st, name: `${s}: ${st.name}` }),
    );
  });
  return out;
}

function branchTooltip(
  steps: FunnelStep[],
  name: string,
  opts?: {
    percentBasis: (keyof PctBases)[];
    entryV: number;
    prevFirst: number;
    e2eRef: number;
  },
): string {
  // container = вход в этот уровень (self entry); prevFirst = шаг разветвления
  // родителя. Поэтому у первого шага «previous» = осмысленная конверсия входа,
  // а не тривиальные 100%.
  const container = opts?.entryV ?? steps[0]?.value ?? 0;
  const prevFirst = opts?.prevFirst ?? container;
  const e2eRef = opts?.e2eRef ?? container;
  const order: (keyof PctBases)[] = ['previous', 'container', 'e2e'];
  const sfx: Record<string, string> = {
    previous: ' step',
    container: ' of entry',
    e2e: ' E2E',
  };
  const rows = steps
    .map((s, i) => {
      const prev = i === 0 ? prevFirst : steps[i - 1].value;
      const bases: PctBases = { previous: prev, container, e2e: e2eRef };
      let pctTxt: string;
      if (opts && opts.percentBasis.length) {
        const parts: { b: keyof PctBases; base: number }[] = [];
        order
          .filter(b => opts.percentBasis.includes(b))
          .forEach(b => {
            const base = bases[b];
            if (!parts.some(p => p.base === base)) parts.push({ b, base });
          });
        pctTxt = parts
          .map(
            p =>
              pctFmt(p.base > 0 ? s.value / p.base : NaN) +
              (parts.length > 1 ? sfx[p.b] : ''),
          )
          .join(' · ');
      } else {
        pctTxt = pctFmt(container ? s.value / container : NaN);
      }
      return (
        `<div style="display:flex;gap:14px;line-height:1.7"><span>${s.name}</span>` +
        `<span style="margin-left:auto;font-weight:600">${numFmt(s.value)}` +
        ` (${pctTxt})</span></div>`
      );
    })
    .join('');
  // подзаголовок «вход» — доля входа контейнера от родителя (напр. под-ветка от
  // «Аккаунт создан»). Виден всегда, даже если заголовок колонки обрезан.
  const firstV = steps[0]?.value ?? 0;
  const entryNote =
    prevFirst > 0 && firstV > 0 && Math.abs(prevFirst - firstV) > 0.5
      ? `<div style="opacity:.7;margin-bottom:4px">вход · ${numFmt(firstV)} · ` +
        `${pctFmt(firstV / prevFirst)}</div>`
      : '';
  return `<div style="font-weight:600;margin-bottom:4px">${name}</div>${entryNote}${rows}`;
}

function buildFacetSeries(
  facet: { name: string | null; data: SplitFunnelData },
  idx: number,
  style: SplitFunnelStyle,
  cellW: number,
  dx: number,
  dy: number,
  visible: string[],
  collapsed: Record<string, boolean>,
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
  const wantCollapsed = facetMode ? compactCell : !!collapsed['__top'];
  const isCollapsed = wantCollapsed && !!mergeName;
  const sparkline = compactCell && isCollapsed;
  const cellStyle = facetMode ? { ...style, collapsible: false } : style;
  // не отсекаем имена под-веток: их нет в data.branches верхнего уровня, но они
  // нужны renderSubSplit для фильтра видимости. Верхний уровень (shown) и под-сплит
  // сами отбирают присутствующие ветки.
  const visibleF = visible;
  const leak = style.highlightDrop
    ? detectLeak(data, style.dropThreshold, visibleF)
    : null;
  const layout0 = computeLayout(
    data,
    cellStyle,
    cellW,
    visibleF,
    mergeName,
    isCollapsed,
    leak,
    {
      compact: facetMode,
      topPad: facetMode ? (facet.name !== null ? 24 : 8) : undefined,
      sparkline,
    },
    facetMode ? {} : collapsed,
  );
  if (facetMode && facet.name !== null) {
    const trunkFirst = data.trunk[0]?.value ?? 0;
    let title = facet.name;
    if (mergeName && trunkFirst > 0) {
      const total = Object.keys(data.branches)
        .filter(b => visibleF.includes(b))
        .reduce((acc, b) => acc + finalValueAt(data.branches[b], mergeName), 0);
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
  };
  const fz = facetMode ? 11 : 12;
  const e2eStart = data.trunk[0]?.value ?? 0; // начало воронки (E2E-знаменатель)
  // точка разветвления ствола (последний шаг ствола) — «previous» для 1-го шага ветки
  const trunkSplitV = data.trunk[data.trunk.length - 1]?.value ?? e2eStart;
  const pb = style.percentBasis;
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
            {
              percentBasis: pb,
              entryV: e2eStart,
              prevFirst: e2eStart,
              e2eRef: e2eStart,
            },
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
        formatter: () => {
          const bd = data.branches[b];
          const hasSub = Object.keys(bd.branches).length > 0;
          // у ветки с под-ветвлением ствол обрывается на «Аккаунт создан» —
          // дописываем слитый финал ветки (то, что на сегментном баре выхода)
          const steps =
            hasSub && mergeName
              ? [
                  ...bd.trunk,
                  { name: mergeName, order: 99, value: finalValueAt(bd, mergeName) },
                ]
              : bd.trunk;
          return branchTooltip(steps, facet.name ? `${b} — ${facet.name}` : b, {
            percentBasis: pb,
            entryV: bd.trunk[0]?.value ?? e2eStart,
            prevFirst: trunkSplitV,
            e2eRef: e2eStart,
          });
        },
      },
    })),
  ];
  // отдельная серия на каждую под-ветку — свой тултип (только её шаги)
  Object.entries(layout0.subGeoms).forEach(([key, info]) => {
    const sg = shiftGeom(info.geom, dx, dy);
    collectHits(sg);
    series.push({
      name: `__sub_${idx}_${key}`,
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      itemStyle: { color: info.color },
      renderItem: () => ({ type: 'group', children: geomToChildren(sg, fz) }),
      tooltip: {
        formatter: () =>
          branchTooltip(
            info.steps,
            facet.name ? `${info.title} — ${facet.name}` : info.title,
            {
              percentBasis: pb,
              entryV: info.entryV,
              prevFirst: info.prevFirst,
              e2eRef: info.e2eRef,
            },
          ),
      },
    });
  });
  // тогглы (верхняя развилка + под-развилки) — только в одиночном режиме (не в сетке)
  if (!facetMode) {
    layout0.toggles.forEach(tg => {
      const x = tg.x + dx;
      const y = tg.y + dy;
      const isTop = tg.key === '__top';
      series.push({
        name: `__toggle:${tg.key}`,
        type: 'custom',
        coordinateSystem: 'none',
        cursor: 'pointer',
        data: [0],
        silent: false,
        z: 100,
        emphasis: { disabled: true },
        tooltip: {
          formatter: () => (tg.collapsed ? 'Развернуть' : 'Свернуть'),
        },
        renderItem: () => ({
          type: 'group',
          children: [
            {
              type: 'circle',
              shape: { cx: x, cy: y, r: isTop ? 12 : 10 },
              style: {
                fill: style.trunkFill,
                opacity: 1,
                stroke: style.mutedText,
                lineWidth: 1,
              },
            },
            {
              type: 'text',
              style: {
                x,
                y: y + 0.5,
                text: tg.collapsed ? '+' : '−',
                fill: style.trunkText,
                fontSize: isTop ? 14 : 12,
                fontWeight: 600,
                align: 'center',
                verticalAlign: 'middle',
              },
            },
          ],
        }),
      });
    });
  }
  return {
    series,
    bottom: geomBottom(layout),
    toggle: layout0.toggles.length > 0,
    hitRects,
  };
}

function buildOption(
  facets: { name: string | null; data: SplitFunnelData }[],
  style: SplitFunnelStyle,
  width: number,
  selected?: Record<string, boolean>,
  collapsed: Record<string, boolean> = {},
) {
  // Ð¾Ð±ÑÐµÐ´Ð¸Ð½ÑÐ½Ð½ÑÐ¹ ÑÐ¿Ð¸ÑÐ¾Ðº Ð²ÐµÑÐ¾Ðº Ð¿Ð¾ Ð²ÑÐµÐ¼ ÑÐ°ÑÐµÑÐ°Ð¼ â Ð¾Ð±ÑÐ°Ñ Ð»ÐµÐ³ÐµÐ½Ð´Ð°
  const branchTotals: Record<string, number> = {};
  const collectTotals = (d: SplitFunnelData) => {
    Object.entries(d.branches).forEach(([b, bd]) => {
      branchTotals[b] = (branchTotals[b] ?? 0) + containerEntry(bd);
      collectTotals(bd);
    });
  };
  facets.forEach(f => collectTotals(f.data));
  const allBranches = Object.keys(branchTotals).sort(
    (a, b) => branchTotals[b] - branchTotals[a],
  );
  // В легенду выносим ТОЛЬКО ветки верхнего уровня (методы). Под-ветки нельзя:
  // у них нет одноимённой серии (серии зовутся `__sub_*`), поэтому ECharts метит
  // такие legend-элементы как unselected и отдаёт их в params.selected=false —
  // после первого клика по легенде под-ветки пропадали. Под-ветки всегда видимы;
  // их видимостью управляет видимость родительской ветки (renderSubSplit не зовётся
  // для скрытого метода).
  const topLevel = new Set<string>();
  facets.forEach(f => Object.keys(f.data.branches).forEach(b => topLevel.add(b)));
  const legendNames = allBranches.filter(b => topLevel.has(b));
  const visible = allBranches.filter(b =>
    topLevel.has(b) ? !selected || selected[b] !== false : true,
  );

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
        data: legendNames,
        textStyle: { color: style.mutedText, fontSize: 12 },
        ...(selected ? { selected } : {}),
      },
      tooltip: { trigger: 'item' as const, confine: true },
      series,
    },
    hitRects,
    // полная высота контента сетки — чтобы канвас растянуть под неё и дать скролл
    contentHeight: rowBottom + 8,
  };
}

export default function SplitFunnelChart(props: SplitFunnelChartProps) {
  const { facets, style, width, height, columns, onContextMenu } = props;
  const divRef = useRef<HTMLDivElement>(null); // скролл-контейнер
  const innerRef = useRef<HTMLDivElement>(null); // точка монтирования ECharts
  const chartRef = useRef<EChartsType>();
  const selectedRef = useRef<Record<string, boolean> | undefined>(undefined);
  // состояние сворачивания по ключам: '__top' — верхняя развилка, имя ветки — под-развилка
  const collapsedRef = useRef<Record<string, boolean>>(
    style.startCollapsed ? { __top: true } : {},
  );
  const hitRectsRef = useRef<HitRect[]>([]);
  const propsRef = useRef({ facets, style, width, height, columns, onContextMenu });
  propsRef.current = { facets, style, width, height, columns, onContextMenu };

  // Перерисовка: канвас растягиваем на высоту контента (>= видимой),
  // корневой контейнер скроллит вертикально, если сетка не влезла.
  const render = () => {
    const p = propsRef.current;
    const r = buildOption(
      p.facets,
      p.style,
      p.width,
      selectedRef.current,
      collapsedRef.current,
    );
    hitRectsRef.current = r.hitRects;
    const canvasH = Math.max(p.height, r.contentHeight);
    if (innerRef.current) {
      innerRef.current.style.width = `${p.width}px`;
      innerRef.current.style.height = `${canvasH}px`;
    }
    chartRef.current?.resize({ width: p.width, height: canvasH });
    chartRef.current?.setOption(r.option, { replaceMerge: ['series'] });
  };

  useEffect(() => {
    if (!innerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = init(innerRef.current);
      chartRef.current.on('legendselectchanged', (params: any) => {
        selectedRef.current = { ...params.selected };
        render();
      });
      chartRef.current.on('click', (params: any) => {
        const sn: string = params.seriesName ?? '';
        if (sn.startsWith('__toggle:')) {
          const key = sn.slice('__toggle:'.length);
          collapsedRef.current = {
            ...collapsedRef.current,
            [key]: !collapsedRef.current[key],
          };
          render();
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
        if (hit.meta.subbranch && p.columns.subbranch) {
          filters.push({
            col: p.columns.subbranch,
            op: '==',
            val: hit.meta.subbranch,
            formattedVal: hit.meta.subbranch,
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
    render();
  }, [facets, style, width, height]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = undefined;
    },
    [],
  );

  useLayoutEffect(() => {
    render();
  }, [width, height, facets, style]);

  return (
    <Styles ref={divRef} height={height} width={width}>
      <div ref={innerRef} style={{ width, height }} />
    </Styles>
  );
}
