"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioValuePointReadModel } from "@/application/portfolio-read-model";
import { createPortfolioValueAxisFormatter } from "@/application/portfolio-value-axis";

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
  negative,
  label,
}: {
  timeline: readonly PortfolioValuePointReadModel[];
  negative: boolean;
  label: string;
}) {
  const data = timeline.map((point) => ({
    ...point,
    label: formatDate(point.asOf),
  }));
  const formatAxisValue = createPortfolioValueAxisFormatter(
    data.map((point) => point.valueEur),
  );
  const axisWidth = Math.max(
    68,
    ...data.map((point) => formatAxisValue(point.valueEur).length * 7 + 8),
  );
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
            tickFormatter={formatAxisValue}
            tickLine={false}
            width={axisWidth}
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
        </AreaChart>
      </ResponsiveContainer>
      <figcaption>Hover or focus the chart to inspect a dated valuation.</figcaption>
    </figure>
  );
}
