"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { holdingChartDomain } from "@/application/holding-chart-domain";
import type { PeriodPerformanceReadModel } from "@/application/portfolio-read-model";

const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR" });
const axisEur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 2,
});

type Point = NonNullable<PeriodPerformanceReadModel["holdingPoints"]>[number];

export function HoldingPerformanceChart({
  points,
  currency,
  cash,
  label,
}: {
  points: readonly Point[];
  currency: string;
  cash: boolean;
  label: string;
}) {
  if (points.length < 2) return null;
  const domain = holdingChartDomain(points.map((point) => point.valueEur));

  return <figure className="account-performance-chart" aria-label={label}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart accessibilityLayer data={[...points]} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="asOf" axisLine={false} tickLine={false} minTickGap={26} tick={{ fill: "var(--muted)", fontSize: 10 }} />
        <YAxis
          axisLine={false}
          domain={domain}
          tick={{ fill: "var(--muted)", fontSize: 10 }}
          tickCount={4}
          tickFormatter={(value: number) => axisEur.format(value)}
          tickLine={false}
          width={68}
        />
        <Tooltip
          cursor={{ stroke: "var(--chart-cursor)", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as Point | undefined;
            if (!active || !point) return null;
            return <div className="chart-tooltip">
              <span>{point.asOf}</span>
              <strong>Holding value {eur.format(point.valueEur)}</strong>
              {!cash && <small>NAV / price {point.unitPrice} {currency}</small>}
              {!cash && point.priceAsOf !== point.asOf && <small>Price recorded {point.priceAsOf}</small>}
            </div>;
          }}
        />
        <Area
          dataKey="valueEur"
          fill="var(--gain)"
          fillOpacity={0.1}
          stroke="var(--gain)"
          strokeWidth={2}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          type="monotone"
        />
      </AreaChart>
    </ResponsiveContainer>
  </figure>;
}
