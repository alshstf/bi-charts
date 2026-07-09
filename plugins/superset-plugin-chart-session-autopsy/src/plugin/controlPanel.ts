import { t } from '@apache-superset/core/translation';
import { validateNonEmpty } from '@superset-ui/core';
import {
  ControlPanelConfig,
  sharedControls,
} from '@superset-ui/chart-controls';

const col = (
  name: string,
  label: string,
  description: string,
  required = false,
) => ({
  name,
  config: {
    ...sharedControls.groupby,
    multi: false,
    label,
    description,
    validators: required ? [validateNonEmpty] : [],
  },
});

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Session data'),
      expanded: true,
      controlSetRows: [
        [col('session_id_col', t('Session ID column'), t('Column that identifies the session (the join key).'), true)],
        [col('event_time_col', t('Event time'), t('Timestamp column that orders the events.'), true)],
        [col('step_col', t('Step / event'), t('Column with the userflow step or event name.'), true)],
        [col('branch_col', t('Branch / method'), t('Optional. Lane the event belongs to (e.g. sms / email / sber_id). Empty / common / trunk values become the shared «trunk» lane.'))],
        [col('status_col', t('Status'), t('Optional. ok / error / warn — drives node colour and outcome.'))],
        [
          col('error_code_col', t('Error code'), t('Optional. Shown on the failing step.')),
          col('error_msg_col', t('Error message'), t('Optional. Shown on the failing step.')),
        ],
        [
          col('latency_col', t('Latency (ms)'), t('Optional. Numeric latency per event.')),
          col('screen_col', t('Screen / route'), t('Optional. Screen or route of the event.')),
        ],
        [
          col('user_col', t('User'), t('Optional. Shown in the header.')),
          col('partner_col', t('Partner'), t('Optional. Shown in the header.')),
          col('device_col', t('Device'), t('Optional. Shown in the header.')),
        ],
        [
          {
            name: 'extra_cols',
            config: {
              ...sharedControls.groupby,
              multi: true,
              label: t('Extra raw columns'),
              description: t(
                'Optional. Extra columns to fetch and show in the per-event raw panel (click a step). A JSON column (e.g. «details» = the Details map) is auto-expanded into key.subkey rows for troubleshooting.',
              ),
              validators: [],
            },
          },
        ],
        [
          {
            name: 'session_id',
            config: {
              type: 'TextControl',
              label: t('Session ID'),
              default: '',
              renderTrigger: false,
              description: t(
                'Which session to dissect. Leave empty to let a dashboard filter or drill-to-detail on the session column pick it.',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Display'),
      expanded: true,
      controlSetRows: [
        ['color_scheme'],
        [
          {
            name: 'default_view',
            config: {
              type: 'SelectControl',
              label: t('Default view'),
              renderTrigger: true,
              clearable: false,
              default: 'swimlane',
              choices: [
                ['swimlane', t('Swimlane (timeline by branch)')],
                ['graph', t('Path graph')],
              ],
              description: t('Both are available via the in-chart toggle; this sets the initial one.'),
            },
          },
          {
            name: 'orientation',
            config: {
              type: 'SelectControl',
              label: t('Swimlane orientation'),
              renderTrigger: true,
              clearable: false,
              default: 'horizontal',
              choices: [
                ['horizontal', t('Horizontal (time →)')],
                ['vertical', t('Vertical (time ↓)')],
              ],
            },
          },
        ],
        [
          {
            name: 'canonical_steps',
            config: {
              type: 'TextAreaControl',
              label: t('Canonical step order'),
              default: '',
              offerEditInModal: false,
              description: t(
                'Optional: ordered step names (one per line) for «furthest reached» and precise back-navigation detection. If empty, derived heuristically from the session.',
              ),
            },
          },
        ],
        [
          {
            name: 'benign_errors',
            config: {
              type: 'TextAreaControl',
              label: t('Benign errors (not real failures)'),
              default: '',
              offerEditInModal: false,
              description: t(
                'Optional: error codes that are expected control-flow signals, not failures (one per line). Such events are shown as a normal (green) step — excluded from the outcome, root cause and error callout. Use «code» to match anywhere, or «step_substring:code» to match only on a given step. E.g. «auth_send_otp_registration:credentials_conflict» (login form used for implicit signup — this error just means the user already exists).',
              ),
            },
          },
        ],
        [
          {
            name: 'ignore_steps',
            config: {
              type: 'TextAreaControl',
              label: t('Ignored / noise steps (dropped)'),
              default: '',
              offerEditInModal: false,
              description: t(
                'Optional: substrings of step names (one per line) to drop entirely — pure noise that isn\'t part of the user flow, e.g. «session_refreshed» (background keep-alive that can spam 100s of repeats). Unlike service steps, these leave NO marker.',
              ),
            },
          },
        ],
        [
          {
            name: 'service_steps',
            config: {
              type: 'TextAreaControl',
              label: t('Service / technical steps'),
              default: '',
              offerEditInModal: false,
              description: t(
                'Optional: substrings of step names (one per line) that are technical, not real user steps — e.g. «get_state» (SPA loaded a screen and fetched user state). They are NOT drawn as nodes (no false back-navigation / lane jumps); instead a small ⟳ marker on the next real step shows a state fetch happened.',
              ),
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    row_limit: { default: 1000 },
  },
};

export default config;
