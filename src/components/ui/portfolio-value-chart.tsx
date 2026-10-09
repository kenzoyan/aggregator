"use client";

import { useEffect, useState } from "react";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioChartEventReadModel, PortfolioValuePointReadModel } from "@/application/portfolio-read-model";
import { createPortfolioValueAxisFormatter } from "@/application/portfolio-value-axis";
import { portfolioChartPointsWithEvents } from "@/application/portfolio-chart-events";
import { ReviewDialog } from "@/components/ui/review-dialog";

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

function eventAmount(event: PortfolioChartEventReadModel) {
  return new Intl.NumberFormat("en-FI", { style: "currency", currency: event.amount.currency,
    minimumFractionDigits: 2 }).format(Number(event.amount.amount));
}

function EventDetails({ event }: { event: PortfolioChartEventReadModel }) {
  return <li>
    <div><strong>{event.label}</strong><strong>{eventAmount(event)}</strong></div>
    <small>{formatDate(event.asOf.slice(0, 10))} · {event.account}</small>
    <small>{event.note}</small>
  </li>;
}

export function PortfolioValueChart({
  timeline,
  negative,
  label,
  events = [],
}: {
  timeline: readonly PortfolioValuePointReadModel[];
  negative: boolean;
  label: string;
  events?: readonly PortfolioChartEventReadModel[];
}) {
  const [selectedPoint, setSelectedPoint] = useState<{ asOf: string; events: PortfolioChartEventReadModel[] }>();
  useEffect(() => { setSelectedPoint(undefined); }, [timeline]);
  const data = portfolioChartPointsWithEvents(timeline, events).map((point) => ({
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
                  {point.events.length > 0 && <>
                    <ul className="chart-event-list">
                      {point.events.slice(0, 3).map((event) => <EventDetails key={event.id} event={event} />)}
                    </ul>
                    <small>{point.events.length > 3 ? `${point.events.length - 3} more events · ` : ""}Click the dot for all details</small>
                  </>}
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
            dot={(props) => {
              const point = props.payload as (typeof data)[number];
              if (!point?.events.length) return <g key={point?.asOf ?? props.index} />;
              return <g key={point.asOf} className="chart-event-marker" role="button" tabIndex={0}
                aria-label={`${formatDate(point.asOf)} · ${point.events.length} recorded events. Show details`}
                onClick={() => setSelectedPoint(point)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault(); setSelectedPoint(point);
                } }}>
                <title>{point.events.map((event) => `${event.label} ${eventAmount(event)}`).join("; ")}</title>
                <circle cx={props.cx} cy={props.cy} r={12} fill="transparent" />
                <circle className="chart-event-marker-ring" cx={props.cx} cy={props.cy} r={7} fill="var(--surface)" stroke="var(--muted)" strokeWidth={1.5} />
                <circle cx={props.cx} cy={props.cy} r={3} fill="var(--ink)" />
              </g>;
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <figcaption>{data.some((point) => point.events.length)
        ? "Dots mark recorded activity · click for details"
        : "Hover or focus the chart to inspect a dated valuation."}</figcaption>
      <ReviewDialog open={Boolean(selectedPoint)} title={`Recorded activity · ${selectedPoint ? formatDate(selectedPoint.asOf) : ""}`} onClose={() => setSelectedPoint(undefined)}>
        <ul className="chart-event-list chart-event-review">
          {selectedPoint?.events.map((event) => <EventDetails key={event.id} event={event} />)}
        </ul>
      </ReviewDialog>
    </figure>
  );
}
