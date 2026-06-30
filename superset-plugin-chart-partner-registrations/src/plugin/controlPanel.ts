import { t } from '@apache-superset/core/translation';
import {
  ControlPanelConfig,
  ControlPanelsContainerProps,
  getStandardizedControls,
  sharedControls,
} from '@superset-ui/chart-controls';

const isAreaMode = ({ controls }: ControlPanelsContainerProps) =>
  controls?.chart_mode?.value !== 'line';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        ['x_axis'],
        ['time_grain_sqla'],
        ['metrics'],
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Partner service'),
              description: t(
                'Dimension to split registrations by, e.g. the partner / referrer service column',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Chart Style'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'chart_mode',
            config: {
              type: 'SelectControl',
              label: t('Chart mode'),
              renderTrigger: true,
              clearable: false,
              default: 'stacked_area',
              choices: [
                ['stacked_area', t('Stacked area (composition + total)')],
                ['area', t('Overlapping area (compare trends)')],
                ['line', t('Line (many partners / clean compare)')],
              ],
              description: t(
                'Stacked area shows total volume and each partner’s share; ' +
                  'overlapping area and line are better for comparing trends.',
              ),
            },
          },
        ],
        [
          {
            name: 'smooth_line',
            config: {
              type: 'CheckboxControl',
              label: t('Smooth lines'),
              renderTrigger: true,
              default: true,
              description: t('Apply curve smoothing to the series'),
            },
          },
          {
            name: 'show_markers',
            config: {
              type: 'CheckboxControl',
              label: t('Show markers'),
              renderTrigger: true,
              default: false,
              description: t('Draw a dot on every data point'),
            },
          },
        ],
        [
          {
            name: 'area_opacity',
            config: {
              type: 'SliderControl',
              label: t('Area opacity'),
              renderTrigger: true,
              min: 0,
              max: 1,
              step: 0.05,
              default: 0.55,
              visibility: isAreaMode,
              description: t('Opacity of the area fill'),
            },
          },
        ],
        [
          {
            name: 'gradient_fill',
            config: {
              type: 'CheckboxControl',
              label: t('Gradient fill'),
              renderTrigger: true,
              default: true,
              visibility: isAreaMode,
              description: t('Fade the area fill towards the x-axis'),
            },
          },
        ],
        ['color_scheme'],
        [
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show legend'),
              renderTrigger: true,
              default: true,
            },
          },
          {
            name: 'zoomable',
            config: {
              type: 'CheckboxControl',
              label: t('Data zoom'),
              renderTrigger: true,
              default: false,
              description: t('Enable a drag-to-zoom slider under the chart'),
            },
          },
        ],
        ['y_axis_format'],
        [
          {
            name: 'x_axis_time_format',
            config: {
              ...sharedControls.x_axis_time_format,
              default: 'smart_date',
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    row_limit: { default: 10000 },
  },
  formDataOverrides: formData => ({
    ...formData,
    metrics: getStandardizedControls().popAllMetrics(),
    groupby: getStandardizedControls().popAllColumns(),
  }),
};

export default config;
