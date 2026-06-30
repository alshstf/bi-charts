import { t } from '@apache-superset/core/translation';
import { Behavior, ChartMetadata, ChartPlugin } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import thumbnail from '../images/thumbnail.png';

export default class SessionAutopsyChartPlugin extends ChartPlugin {
  constructor() {
    super({
      buildQuery,
      controlPanel,
      transformProps,
      loadChart: () => import('../SessionAutopsyChart'),
      metadata: new ChartMetadata({
        name: t('Session Autopsy'),
        description: t(
          'Dissect a single user session: swimlane timeline by branch plus a path graph, ' +
            'to diagnose «what went wrong» at a glance. Reads raw event rows for one session_id.',
        ),
        thumbnail,
        behaviors: [Behavior.InteractiveChart],
        category: t('KPI'),
        tags: [t('GigaID'), t('Diagnostics'), t('Session'), t('Flow')],
      }),
    });
  }
}
