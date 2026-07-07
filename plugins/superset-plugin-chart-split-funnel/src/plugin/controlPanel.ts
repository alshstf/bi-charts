import { t } from '@apache-superset/core/translation';
import { validateNonEmpty } from '@superset-ui/core';
import {
  ControlPanelConfig,
  sharedControls,
} from '@superset-ui/chart-controls';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'step_col',
            config: {
              ...sharedControls.groupby,
              multi: false,
              label: t('Step'),
              description: t('Column with funnel step name'),
              validators: [validateNonEmpty],
            },
          },
        ],
        [
          {
            name: 'step_order_col',
            config: {
              ...sharedControls.groupby,
              multi: false,
              label: t('Step order'),
              description: t(
                'Numeric column that orders steps (within trunk and within each branch). ' +
                  'If empty, steps are ordered by value descending.',
              ),
            },
          },
        ],
        [
          {
            name: 'branch_col',
            config: {
              ...sharedControls.groupby,
              multi: false,
              label: t('Branch'),
              description: t(
                'Column with the branch name (e.g. sms / email / sber_id). ' +
                  'Rows with empty value are treated as the common trunk before the split.',
              ),
            },
          },
        ],
        [
          {
            name: 'subbranch_col',
            config: {
              ...sharedControls.groupby,
              multi: false,
              label: t('Sub-branch'),
              description: t(
                'Optional 2nd-level branch nested inside each branch (branch-in-branch). ' +
                  'E.g. within a given branch: which sub-method or channel was used. ' +
                  'Rows with empty value are the branch trunk before the sub-split; ' +
                  'sub-branches re-merge at the branch final step.',
              ),
            },
          },
        ],
        [
          {
            name: 'small_multiples_col',
            config: {
              ...sharedControls.groupby,
              multi: false,
              label: t('Small multiples by'),
              description: t(
                'Optional dimension to facet by (e.g. partner): renders a grid ' +
                  'of mini funnels, one per value, sharing legend and scale logic.',
              ),
            },
          },
        ],
        ['metric'],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Chart Style'),
      expanded: true,
      controlSetRows: [
        ['color_scheme'],
        [
          {
            name: 'hide_entry_step',
            config: {
              type: 'CheckboxControl',
              label: t('Hide entry (first trunk) step'),
              renderTrigger: true,
              default: false,
              description: t(
                'Drop the very first common (trunk) step — e.g. the "entered" bar — ' +
                  'so the funnel starts from the next step. Percentages rebase to the new first step. ' +
                  'A per-chart toggle equivalent to filtering out the lowest step_order.',
              ),
            },
          },
        ],
        [
          {
            name: 'trunk_style',
            config: {
              type: 'SelectControl',
              label: t('Trunk style'),
              renderTrigger: true,
              clearable: false,
              default: 'graphite',
              choices: [
                ['graphite', t('Graphite (theme-aware neutral)')],
                ['brand', t('Brand (first scheme color)')],
                ['subtle', t('Subtle (background fill)')],
              ],
              description: t(
                'Color of the common (trunk) steps and the merged total bar. ' +
                  'Graphite adapts to light/dark theme automatically.',
              ),
            },
          },
        ],
        [
          {
            name: 'collapsible',
            config: {
              type: 'CheckboxControl',
              label: t('Collapsible branches'),
              renderTrigger: true,
              default: true,
              description: t(
                'Show a toggle at the split point: collapsed view hides branch ' +
                  'columns and connects the trunk straight to the merged total.',
              ),
            },
          },
          {
            name: 'start_collapsed',
            config: {
              type: 'CheckboxControl',
              label: t('Start collapsed'),
              renderTrigger: true,
              default: false,
              visibility: ({ controls }: any) =>
                Boolean(controls?.collapsible?.value),
            },
          },
        ],
        [
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show legend'),
              renderTrigger: true,
              default: true,
              description: t(
                'Legend toggles branches on/off; remaining branches re-layout',
              ),
            },
          },
        ],
        [
          {
            name: 'merge_final_step',
            config: {
              type: 'CheckboxControl',
              label: t('Merge final step'),
              renderTrigger: true,
              default: true,
              description: t(
                'If the last step has the same name in every branch, draw it as a ' +
                  'single merged bar segmented by branch contribution, with the ' +
                  'overall rate. Toggling a branch off in the legend re-computes the total.',
              ),
            },
          },
        ],
        [
          {
            name: 'value_display',
            config: {
              type: 'SelectControl',
              label: t('Value display'),
              renderTrigger: true,
              clearable: false,
              default: 'both',
              choices: [
                ['both', t('Count and percent')],
                ['absolute', t('Count only')],
                ['percent', t('Percent only')],
              ],
            },
          },
          {
            name: 'percent_basis',
            config: {
              type: 'SelectControl',
              label: t('Percent basis'),
              renderTrigger: true,
              multi: true,
              clearable: false,
              default: ['container'],
              choices: [
                ['previous', t('Previous step')],
                ['container', t('Container entry (branch/trunk start)')],
                ['e2e', t('Funnel start (E2E)')],
              ],
              description: t(
                'Denominators for step percentages, applied to every step incl. ' +
                  'trunk. Previous step = step-by-step conversion (branch entry ' +
                  'is measured against the split point). Select several to show ' +
                  'them side by side; identical denominators are deduplicated.',
              ),
            },
          },
        ],
        [
          {
            name: 'bar_alignment',
            config: {
              type: 'SelectControl',
              label: t('Bar alignment'),
              renderTrigger: true,
              clearable: false,
              default: 'left',
              choices: [
                ['left', t('Left')],
                ['center', t('Center (classic funnel)')],
                ['right', t('Right')],
              ],
            },
          },
          {
            name: 'grid_cell_detail',
            config: {
              type: 'SelectControl',
              label: t('Grid cell detail'),
              renderTrigger: true,
              clearable: false,
              default: 'compact',
              choices: [
                ['compact', t('Compact (collapsed sparkline)')],
                ['full', t('Full funnel')],
              ],
              description: t(
                'Only applies in small-multiples (grid) mode. Compact renders each ' +
                  'cell as a collapsed sparkline — tight trunk plus one segmented ' +
                  'success bar, no branch columns or connectors — so partner mixes ' +
                  'compare at a glance. Full draws the complete funnel in every cell.',
              ),
              visibility: ({ controls }: any) =>
                Boolean(controls?.small_multiples_col?.value),
            },
          },
        ],
        [
          {
            name: 'highlight_drop',
            config: {
              type: 'CheckboxControl',
              label: t('Highlight biggest drop-off'),
              renderTrigger: true,
              default: true,
              description: t(
                'Mark the step with the worst step-to-step conversion (the biggest ' +
                  'leak) with an amber badge and shaded lost volume. Looks across the ' +
                  'common trunk and inside each branch; the split into branches is not ' +
                  'counted as a drop.',
              ),
            },
          },
          {
            name: 'drop_threshold',
            config: {
              type: 'SelectControl',
              label: t('Drop-off threshold'),
              renderTrigger: true,
              clearable: false,
              default: '30',
              choices: [
                ['10', t('10%')],
                ['20', t('20%')],
                ['30', t('30%')],
                ['40', t('40%')],
                ['50', t('50%')],
                ['60', t('60%')],
              ],
              description: t(
                'Only flag the worst step when its drop is at least this large. ' +
                  'Healthy funnels stay clean.',
              ),
              visibility: ({ controls }: any) =>
                Boolean(controls?.highlight_drop?.value),
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
