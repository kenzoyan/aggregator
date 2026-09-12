"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioValuePointReadModel } from "@/application/portfolio-read-model";

const compactEur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const exactEur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const dateLabel = new Intl.DateTimeFormat("en-FI", {
  month: "short",
  day: "numeric",
});

function formatDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dateLabel.format(new Date(`${value}T12:00:00Z`))
    : value;
}

export function PortfolioValueChart({
  timeline,
  activityMarkerDates,
  negative,
  label,
}: {
  timeline: readonly PortfolioValuePointReadModel[];
  activityMarkerDates: ReadonlySet<string>;
  negative: boolean;
  label: string;
}) {
  const data = timeline.map((point) => ({
    ...point,
    label: formatDate(point.asOf),
  }));
  const stroke = negative ? "var(--loss)" : "var(--gain)";

  return (
    <figure className="portfolio-chart" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{ top: 22, right: 12, bottom: 2, left: 0 }}
        >
          <defs>
            <linearGradient id="portfolio-value-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.2} />
              <stop offset="78%" stopColor={stroke} stopOpacity={0.025} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="2 6" />
          <XAxis
            axisLine={false}
            dataKey="label"
            minTickGap={28}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            domain={["dataMin", "dataMax"]}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(value: number) => compactEur.format(value)}
            tickLine={false}
            width={68}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-cursor)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !point) return null;
              return (
                <div className="chart-tooltip">
                  <span>{point.label}</span>
                  <strong>{exactEur.format(point.valueEur)}</strong>
                  {point.holdingActivities.length > 0 && (
                    <small>{point.holdingActivities.length} holding change{point.holdingActivities.length === 1 ? "" : "s"}</small>
                  )}
                </div>
              );
            }}
          />
          <Area
            dataKey="valueEur"
            fill="url(#portfolio-value-fill)"
            isAnimationActive={false}
            stroke={stroke}
            strokeWidth={2.4}
            type="monotone"
          />
          {data
            .filter((point) => activityMarkerDates.has(point.asOf))
            .map((point) => (
              <ReferenceDot
                key={point.asOf}
                fill="var(--surface)"
                r={4}
                stroke="var(--accent)"
                strokeWidth={2}
                x={point.label}
                y={point.valueEur}
              />
            ))}
        </AreaChart>
      </ResponsiveContainer>
      <figcaption>Hover or focus the chart to inspect a dated valuation.</figcaption>
    </figure>
  );
}
