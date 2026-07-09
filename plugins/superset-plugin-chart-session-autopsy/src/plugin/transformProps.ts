import {
  CategoricalColorNamespace,
  ChartProps,
  DataRecord,
  getColumnLabel,
} from '@superset-ui/core';
import {
  EventStatus,
  SessionDiagnostics,
  SessionEvent,
} from '../types';

const TRUNK = new Set(['', 'common', '(all)', 'null', 'undefined', 'trunk', 'общий']);
const isTrunk = (v: unknown) =>
  v === null || v === undefined || TRUNK.has(String(v).trim().toLowerCase());

function fmtTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toMs(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // sec -> ms эвристика
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? 0 : n;
}

function normStatus(raw: string, hasErr: boolean): EventStatus {
  const s = raw.trim().toLowerCase();
  if (/error|fail|err|exception|denied/.test(s)) return 'error';
  if (/back|назад|nav/.test(s)) return 'nav';
  if (/warn|timeout|retry|pending|wait/.test(s)) return 'warn';
  if (/ok|success|done|complete|200|усп/.test(s)) return 'ok';
  if (s === '' && hasErr) return 'error';
  return 'ok';
}

export default function transformProps(chartProps: ChartProps) {
  const { width, height, formData, queriesData, theme } = chartProps;
  const raw = chartProps.rawFormData as Record<string, any>;
  const {
    colorScheme,
    defaultView = 'swimlane',
    orientation = 'horizontal',
    canonicalSteps: canonicalStepsRaw = '',
    sliceId,
  } = formData as Record<string, any>;

  // DnD-контролы хранят значение массивом (["col"]) — берём первый элемент
  const one = (v: any) => (Array.isArray(v) ? v[0] : v);
  const key = (c: any) => {
    const v = one(c);
    return v ? getColumnLabel(v) : null;
  };
  const kSession = key(raw.session_id_col);
  const kTime = key(raw.event_time_col);
  const kStep = key(raw.step_col) ?? 'step';
  const kBranch = key(raw.branch_col);
  const kStatus = key(raw.status_col);
  const kErrCode = key(raw.error_code_col);
  const kErrMsg = key(raw.error_msg_col);
  const kLatency = key(raw.latency_col);
  const kScreen = key(raw.screen_col);
  const kUser = key(raw.user_col);
  const kPartner = key(raw.partner_col);
  const kDevice = key(raw.device_col);

  let rows = ((queriesData?.[0]?.data ?? []) as DataRecord[]).slice();

  // чарт показывает ОДНУ сессию. Приоритет:
  //  1) если запрос УЖЕ сужен до одной сессии (кросс-фильтр из «Ленты сбоев» или
  //     нативный фильтр дашборда) — берём её, даже если задан контрол session_id;
  //  2) иначе — явный контрол session_id (дефолт в explore);
  //  3) иначе — первая встретившаяся сессия.
  let needsSession = false;
  if (kSession && rows.length) {
    const ctrlSid =
      (formData as Record<string, any>).sessionId ?? raw.session_id ?? null;
    const distinct = new Set(rows.map(r => String(r[kSession])));
    if (distinct.size === 1) {
      // запрос уже сужен до одной сессии (кросс-фильтр/фильтр дашборда) — ок
    } else if (ctrlSid != null && String(ctrlSid) !== '') {
      rows = rows.filter(r => String(r[kSession]) === String(ctrlSid));
    } else {
      // выборка содержит НЕСКОЛЬКО сессий и ни одна не выбрана — произвольную не
      // показываем (её события ещё и обрезаны row_limit'ом), просим выбрать
      needsSession = true;
      rows = [];
    }
  }

  // --- первичный проход: сырьё -> события ---
  type Pre = Omit<
    SessionEvent,
    'idx' | 'gapMs' | 'isBack' | 'isRetry' | 'stateFetch'
  >;
  const preAll: Pre[] = rows.map(r => {
    const errorCode = kErrCode ? (r[kErrCode] as string) || undefined : undefined;
    const errorMsg = kErrMsg ? (r[kErrMsg] as string) || undefined : undefined;
    const statusRaw = kStatus ? String(r[kStatus] ?? '') : '';
    const time = kTime ? toMs(r[kTime]) : 0;
    const branchVal = kBranch ? r[kBranch] : null;
    return {
      time,
      timeLabel: fmtTime(time),
      step: String(r[kStep] ?? ''),
      branch: isTrunk(branchVal) ? 'trunk' : String(branchVal),
      status: normStatus(statusRaw, !!errorCode),
      errorCode,
      errorMsg,
      latencyMs: kLatency ? Number(r[kLatency] ?? NaN) : undefined,
      screen: kScreen ? (r[kScreen] as string) || undefined : undefined,
      raw: r as Record<string, unknown>,
    };
  });

  // сортировка по времени (стабильная); без времени — порядок запроса
  preAll.forEach((e, i) => ((e as any)._i = i));
  preAll.sort((a, b) =>
    a.time && b.time ? a.time - b.time : (a as any)._i - (b as any)._i,
  );

  // --- служебные (технические) шаги: не рисуем как узлы ---
  // напр. get_state = SPA загрузил экран и дёрнул состояние. Как отдельные шаги
  // они дают ложные возвраты/прыжки между дорожками. Схлопываем: считаем их
  // «загрузками состояния» и вешаем маркер ⟳ на следующий РЕАЛЬНЫЙ шаг.
  // formData у Superset в camelCase (serviceSteps), rawFormData — snake_case
  const serviceRaw =
    (formData as any).serviceSteps ?? raw.service_steps ?? '';
  const serviceTokens = String(serviceRaw)
    .split(/\r?\n|,/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const isService = (step: string) => {
    const s = step.trim().toLowerCase();
    return serviceTokens.some(tok => s === tok || s.includes(tok));
  };
  type PreS = Pre & { stateFetch: number };
  const pre: PreS[] = [];
  let pendingSvc = 0;
  preAll.forEach(e => {
    if (serviceTokens.length && e.step && isService(e.step)) {
      pendingSvc += 1;
      return;
    }
    pre.push({ ...e, stateFetch: pendingSvc });
    pendingSvc = 0;
  });
  // хвостовые служебные события — на последний реальный шаг
  if (pendingSvc && pre.length) pre[pre.length - 1].stateFetch += pendingSvc;

  // --- канонический порядок шагов ---
  const provided = String(canonicalStepsRaw)
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter(Boolean);
  const canon: string[] = provided.slice();
  if (!canon.length) {
    const seen = new Set<string>();
    pre.forEach(e => {
      if (e.step && !seen.has(e.step)) {
        seen.add(e.step);
        canon.push(e.step);
      }
    });
  }
  const cidx = (s: string) => {
    const i = canon.indexOf(s);
    return i < 0 ? canon.length : i;
  };

  // --- второй проход: idx, паузы, back/retry ---
  const seen = new Set<string>();
  let prevStep = '';
  let prevTime = 0;
  const events: SessionEvent[] = pre.map((e, i) => {
    const gapMs = prevTime && e.time ? e.time - prevTime : 0;
    const isRetry = seen.has(e.step);
    const isBack =
      e.status === 'nav' || (i > 0 && cidx(e.step) < cidx(prevStep));
    seen.add(e.step);
    prevStep = e.step;
    prevTime = e.time || prevTime;
    return { ...e, idx: i + 1, gapMs, isBack, isRetry };
  });

  // --- дорожки ---
  const lanes: string[] = ['trunk'];
  events.forEach(e => {
    if (e.branch !== 'trunk' && !lanes.includes(e.branch)) lanes.push(e.branch);
  });
  const laneLabels: Record<string, string> = { trunk: 'Общий' };
  lanes.forEach(l => {
    if (l !== 'trunk') laneLabels[l] = l;
  });

  // --- диагностика ---
  const branchesTried = lanes.filter(l => l !== 'trunk');
  const backCount = events.filter(e => e.isBack).length;
  const retryCount = events.filter(e => e.isRetry && e.status !== 'nav').length;
  const errors = events.filter(e => e.status === 'error');
  const errorEvent = errors.length ? errors[errors.length - 1] : undefined;
  const hasSuccess = events.some(
    e => e.status !== 'error' && /усп|success|complete|done|registered/i.test(e.step),
  );
  const outcome: SessionDiagnostics['outcome'] = hasSuccess
    ? 'success'
    : errors.length
      ? 'error'
      : 'abandoned';
  const outcomeLabel =
    outcome === 'success' ? 'Успех' : outcome === 'error' ? 'Ошибка' : 'Брошено';

  const furthestStep =
    events.reduce(
      (best, e) => (cidx(e.step) >= cidx(best) ? e.step : best),
      events[0]?.step ?? '',
    ) || '';

  const rootCause = errorEvent
    ? `${errorEvent.errorCode ? `${errorEvent.errorCode}: ` : ''}${
        errorEvent.errorMsg || errorEvent.step
      }`
    : outcome === 'abandoned'
      ? 'не завершил сессию'
      : '—';

  const durationMs =
    events.length && events[events.length - 1].time && events[0].time
      ? events[events.length - 1].time - events[0].time
      : 0;

  const narrative = (() => {
    const parts: string[] = [];
    if (branchesTried.length)
      parts.push(`ветки: ${branchesTried.join(' → ')}`);
    if (backCount) parts.push(`возвратов ${backCount}`);
    if (retryCount) parts.push(`повторов ${retryCount}`);
    const tail = errorEvent
      ? `сломалось на «${errorEvent.step}» (${errorEvent.errorCode || 'ошибка'})`
      : outcome === 'success'
        ? 'дошёл до успеха'
        : 'ушёл, не завершив';
    return parts.length ? `${parts.join(', ')}; ${tail}` : tail;
  })();

  const diagnostics: SessionDiagnostics = {
    outcome,
    outcomeLabel,
    narrative,
    backCount,
    branchesTried,
    retryCount,
    furthestStep,
    rootCause,
    errorEvent,
    durationMs,
  };

  // --- meta ---
  const first = (rows[0] ?? {}) as DataRecord;
  const meta = {
    sessionId: kSession ? String(first[kSession] ?? '—') : '—',
    user: kUser ? String(first[kUser] ?? '') || undefined : undefined,
    partner: kPartner ? String(first[kPartner] ?? '') || undefined : undefined,
    device: kDevice ? String(first[kDevice] ?? '') || undefined : undefined,
    startLabel: events[0]?.timeLabel || undefined,
  };

  // --- цвета дорожек ---
  const colorScale = CategoricalColorNamespace.getScale(colorScheme as string);
  const th = theme as Record<string, any> | undefined;
  const branchColors: Record<string, string> = {
    trunk: th?.colorTextSecondary ?? '#6b6b6b',
  };
  branchesTried.forEach(b => {
    branchColors[b] = colorScale(b, sliceId);
  });

  const colors = {
    textPrimary: th?.colorText ?? '#1b1b1b',
    textMuted: th?.colorTextTertiary ?? th?.colorTextSecondary ?? '#8a8a8a',
    bg: th?.colorBgContainer ?? '#ffffff',
    bgSubtle: th?.colorBgElevated ?? th?.colorFillQuaternary ?? 'rgba(0,0,0,0.03)',
    border: th?.colorBorder ?? 'rgba(0,0,0,0.12)',
    ok: th?.colorSuccess ?? '#1D9E75',
    error: th?.colorError ?? '#E24B4A',
    warn: th?.colorWarning ?? '#EF9F27',
    nav: th?.colorTextTertiary ?? '#9a9a9a',
    bgDanger: th?.colorErrorBg ?? 'rgba(226,75,74,0.12)',
    bgWarn: th?.colorWarningBg ?? 'rgba(239,159,39,0.14)',
  };

  const onContextMenu = (chartProps as Record<string, any>)?.hooks?.onContextMenu;

  return {
    width,
    height,
    events,
    lanes,
    laneLabels,
    diagnostics,
    meta,
    canonicalSteps: canon,
    needsSession,
    columns: { session: kSession, step: kStep, branch: kBranch },
    onContextMenu,
    style: {
      view: defaultView === 'graph' ? 'graph' : 'swimlane',
      orientation: orientation === 'vertical' ? 'vertical' : 'horizontal',
      branchColors,
      colors,
    },
  };
}
