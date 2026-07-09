export type EventStatus = 'ok' | 'error' | 'warn' | 'nav' | 'info';

export type AutopsyView = 'swimlane' | 'graph';
export type AutopsyOrientation = 'horizontal' | 'vertical';

/** одно событие сессии после нормализации */
export interface SessionEvent {
  idx: number; // порядковый номер 1..n
  time: number; // epoch ms (0 если нет времени)
  timeLabel: string; // hh:mm:ss
  step: string;
  branch: string; // ключ дорожки; 'trunk' = общий ствол
  status: EventStatus;
  errorCode?: string;
  errorMsg?: string;
  latencyMs?: number;
  screen?: string;
  gapMs: number; // пауза от предыдущего события
  isBack: boolean; // возврат к более раннему шагу
  isRetry: boolean; // повтор уже виденного шага
  stateFetch: number; // сколько служебных «загрузок состояния» перед этим шагом (get_state)
  raw: Record<string, unknown>;
}

export interface SessionDiagnostics {
  outcome: 'success' | 'error' | 'abandoned';
  outcomeLabel: string;
  narrative: string;
  backCount: number;
  branchesTried: string[];
  retryCount: number;
  furthestStep: string;
  rootCause: string;
  errorEvent?: SessionEvent;
  durationMs: number;
}

export interface SessionMeta {
  sessionId: string;
  user?: string;
  partner?: string;
  device?: string;
  startLabel?: string;
}

export interface AutopsyColors {
  textPrimary: string;
  textMuted: string;
  bg: string;
  bgSubtle: string;
  border: string;
  ok: string;
  error: string;
  warn: string;
  nav: string;
  bgDanger: string;
  bgWarn: string;
}

export interface SessionAutopsyStyle {
  view: AutopsyView;
  orientation: AutopsyOrientation;
  branchColors: Record<string, string>;
  colors: AutopsyColors;
}

export interface SessionAutopsyChartProps {
  width: number;
  height: number;
  events: SessionEvent[];
  lanes: string[]; // упорядоченные ключи дорожек (trunk первым)
  laneLabels: Record<string, string>;
  diagnostics: SessionDiagnostics;
  meta: SessionMeta;
  canonicalSteps: string[];
  style: SessionAutopsyStyle;
  /** имена колонок датасета — для drill-to-detail фильтров */
  columns: { session: string | null; step: string | null; branch: string | null };
  /** хук Superset для контекстного меню (drill to detail) — есть на дашборде */
  onContextMenu?: (
    clientX: number,
    clientY: number,
    payload: Record<string, unknown>,
  ) => void;
}
