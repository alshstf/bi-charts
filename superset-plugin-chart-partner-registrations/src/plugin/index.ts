import { t } from '@apache-superset/core/translation';
import { Behavior, ChartMetadata, ChartPlugin } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import thumbnail from '../images/thumbnail.png';

export default class PartnerRegistrationsChartPlugin extends ChartPlugin {
  constructor() {
    super({
      buildQuery,
      controlPanel,
      transformProps,
      loadChart: () => import('../PartnerRegistrationsChart'),
      metadata: new ChartMetadata({
        name: t('Partner Registrations Timeseries'),
        description: t(
          'Registrations over time, split by partner service. ' +
            'Supports overlapping area, stacked area and line modes with gradient fills.',
        ),
        thumbnail,
        behaviors: [Behavior.InteractiveChart],
        category: t('Evolution'),
        tags: [t('ECharts'), t('Time-series'), t('GigaID')],
      }),
    });
  }
}
