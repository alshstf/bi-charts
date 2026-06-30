import { t } from '@apache-superset/core/translation';
import { Behavior, ChartMetadata, ChartPlugin } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import thumbnail from '../images/thumbnail.png';

export default class SplitFunnelChartPlugin extends ChartPlugin {
  constructor() {
    super({
      buildQuery,
      controlPanel,
      transformProps,
      loadChart: () => import('../SplitFunnelChart'),
      metadata: new ChartMetadata({
        name: t('Split Funnel'),
        description: t(
          'Funnel with a branching point: common trunk steps, then parallel ' +
            'per-branch mini-funnels (e.g. SMS / email / SberID confirmation). ' +
            'Legend toggles branches with re-layout; works with chart and dashboard filters.',
        ),
        thumbnail,
        behaviors: [Behavior.InteractiveChart, Behavior.DrillToDetail],
        category: t('KPI'),
        tags: [t('ECharts'), t('Funnel'), t('GigaID')],
      }),
    });
  }
}
