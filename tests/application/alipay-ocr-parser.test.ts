import { describe, expect, it } from "vitest";

import {
  AlipayOcrParseError,
  parseAlipayHoldingsMarkdown,
} from "@/application/imports/alipay-ocr-parser";

const syntheticMarkdown = `
# 支付宝基金

更新日期：2026-07-22
总资产：¥2,000.00

| 基金名称 | 示例全球指数基金A |
| --- | --- |
| 基金代码 | 012345 |
| 持有金额 | ¥1,234.56 |
| 持有份额 | 800 |
| 历史成本 | 1,200.00 |
| 持有收益 | +34.56 |
| 持有收益率 | 2.88% |
| 单位净值 | 1.5432 |
| 净值日期 | 2026/07/22 |

| 基金名称 | 示例科技指数基金C |
| --- | --- |
| 基金代码 | 067890 |
| 持有金额 | 765.44 |
| 持有份额 | 400 |
| 历史成本 | 720 |
| 持有收益 | 45.44 |
| 持有收益率 | 6.31% |
| 单位净值 | 1.9136 |
| 净值日期 | 2026-07-22 |
`;

describe("Alipay MinerU Markdown parser", () => {
  it("maps labelled OCR rows into typed screenshot holdings", () => {
    expect(parseAlipayHoldingsMarkdown(syntheticMarkdown, {
      sourceAccountHint: "Alipay",
    })).toEqual({
      accountName: "Alipay",
      asOf: "2026-07-22T00:00:00.000Z",
      currency: "CNY",
      totalValue: "2000.00",
      reportedPriorReturn: null,
      confidence: "high",
      warnings: [
        "MinerU OCR output was parsed with Alipay label rules. Verify all values before confirmation.",
      ],
      positions: [
        {
          displayName: "示例全球指数基金A",
          instrumentCode: "012345",
          quantity: "800",
          currency: "CNY",
          marketValue: "1234.56",
          costBasis: "1200.00",
          reportedPriorReturn: "34.56",
          reportedPriorReturnPercent: "2.88",
          averageCost: null,
          observedPrice: "1.5432",
          priceAsOf: "2026-07-22T00:00:00.000Z",
          confidence: "high",
        },
        {
          displayName: "示例科技指数基金C",
          instrumentCode: "067890",
          quantity: "400",
          currency: "CNY",
          marketValue: "765.44",
          costBasis: "720",
          reportedPriorReturn: "45.44",
          reportedPriorReturnPercent: "6.31",
          averageCost: null,
          observedPrice: "1.9136",
          priceAsOf: "2026-07-22T00:00:00.000Z",
          confidence: "high",
        },
      ],
    });
  });

  it("fails safely instead of creating an empty draft when no holding can be identified", () => {
    expect(() =>
      parseAlipayHoldingsMarkdown("# 支付宝\n这里没有可识别的基金数据")
    ).toThrow(AlipayOcrParseError);
  });

  it("supports MinerU Markdown tables with one holding per row", () => {
    const wideTable = `
| 基金名称 | 基金代码 | 持有金额 | 持有份额 | 历史成本 | 持有收益 | 单位净值 | 净值日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 示例债券基金B | 001122 | 210.50 | 200 | 200 | 10.50 | 1.0525 | 2026-07-22 |
`;

    expect(parseAlipayHoldingsMarkdown(wideTable).positions).toEqual([
      {
        displayName: "示例债券基金B",
        instrumentCode: "001122",
        quantity: "200",
        currency: "CNY",
        marketValue: "210.50",
        costBasis: "200",
        reportedPriorReturn: "10.50",
        reportedPriorReturnPercent: null,
        averageCost: null,
        observedPrice: "1.0525",
        priceAsOf: "2026-07-22T00:00:00.000Z",
        confidence: "high",
      },
    ]);
  });

  it("uses the heading before a labelled fund code as the holding name", () => {
    const plainLayout = `
## 示例消费指数基金A
基金代码：045678
持有金额：500.00
持有份额：250
持有收益：20
单位净值：2
净值日期：2026年7月22日
`;

    expect(parseAlipayHoldingsMarkdown(plainLayout).positions[0]).toMatchObject({
      displayName: "示例消费指数基金A",
      instrumentCode: "045678",
      marketValue: "500.00",
      quantity: "250",
      reportedPriorReturn: "20",
      observedPrice: "2",
      priceAsOf: "2026-07-22T00:00:00.000Z",
    });
  });

  it("supports OCR output where labels and values occupy consecutive lines", () => {
    const stackedLayout = `
## 示例稳健基金D
基金代码
045679
持有金额
333.30
持有份额
300
历史成本
315
持有收益
18.30
单位净值
1.111
净值日期
2026-07-22
`;

    expect(parseAlipayHoldingsMarkdown(stackedLayout).positions[0]).toMatchObject({
      displayName: "示例稳健基金D",
      instrumentCode: "045679",
      marketValue: "333.30",
      quantity: "300",
      costBasis: "315",
      reportedPriorReturn: "18.30",
      observedPrice: "1.111",
      priceAsOf: "2026-07-22T00:00:00.000Z",
    });
  });

  it("separates multiple consecutive-line holdings by their fund codes", () => {
    const stackedLayout = `
## 示例稳健基金D
基金代码
045679
持有金额
333.30
持有份额
300
历史成本
315

## 示例成长基金E
基金代码
045680
持有金额
444.40
持有份额
400
历史成本
420
`;

    expect(parseAlipayHoldingsMarkdown(stackedLayout).positions).toMatchObject([
      {
        displayName: "示例稳健基金D",
        instrumentCode: "045679",
        marketValue: "333.30",
      },
      {
        displayName: "示例成长基金E",
        instrumentCode: "045680",
        marketValue: "444.40",
      },
    ]);
  });

  it("normalizes a fund code whose OCR digits are separated by spaces", () => {
    const spacedCodeLayout = `
## 示例联接基金F
0 4 0 0 4 6
持有金额 500.00
持有份额 50
持仓成本价 9.5
持有收益 25
基金净值 10
`;

    expect(parseAlipayHoldingsMarkdown(spacedCodeLayout).positions[0])
      .toMatchObject({
        displayName: "示例联接基金F",
        instrumentCode: "040046",
        marketValue: "500.00",
        quantity: "50",
        averageCost: "9.5",
        reportedPriorReturn: "25",
        observedPrice: "10",
      });
  });
});
