import { useEffect, useLayoutEffect, useRef } from 'react';
import { styled } from '@apache-superset/core/theme';
import { init, use } from 'echarts/core';
import type { EChartsType } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { PartnerRegistrationsChartProps } from './types';

use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const Styles = styled.div<{ height: number; width: number }>`
  height: ${({ height }: { height: number }) => height}px;
  width: ${({ width }: { width: number }) => width}px;
  overflow: hidden;
`;

export default function PartnerRegistrationsChart(
  props: PartnerRegistrationsChartProps,
) {
  const { echartOptions, width, height } = props;
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType>();

  useEffect(() => {
    if (!divRef.current) return undefined;
    if (!chartRef.current) {
      chartRef.current = init(divRef.current);
    }
    chartRef.current.setOption(echartOptions, { replaceMerge: ['series'] });
    return () => {
      // disposed on unmount only
    };
  }, [echartOptions]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = undefined;
    },
    [],
  );

  useLayoutEffect(() => {
    chartRef.current?.resize({ width, height });
  }, [width, height]);

  return <Styles ref={divRef} height={height} width={width} />;
}
