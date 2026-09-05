# Invest Assets Monitor：架构与实现说明

本文描述当前代码的真实实现，目标是让项目所有者能够理解数据如何进入系统、如何保存、如何计算，以及前端为什么会显示某个结果。文中示例均为抽象示例，不包含真实持仓、截图、数据库或密钥。

## 1. 产品边界

这是一个本地优先、单用户的投资监控应用：

- 聚合多个 Source Account 的基金、ETF、股票、债券与账户内现金。
- 保留资产原币种，同时以 EUR 计算组合总值。
- 区分“持有什么”和“这些资产现在值多少”。
- 截图、CSV、手工输入和 Trading 212 都先产生 Import Draft；用户确认前不会改变持仓。
- 应用只监控和展示，不下单，也不提供投资建议。

最重要的设计原则是：**Holding State 与 Market Data 分开**。数量、成本和账户内现金属于持仓事实；NAV、证券价格和汇率属于市场观察。刷新价格不能修改数量或成本。

## 2. 总体分层

```text
Browser / React
  ├─ Portfolio overview + holding drawer
  ├─ Import review + confirmation
  └─ Source Account management
             │ HTTP / JSON
             ▼
Next.js route handlers
  ├─ validate request
  ├─ call application/domain modules
  └─ translate errors into HTTP responses
             │
             ▼
Application modules
  ├─ import parsing and editable read models
  ├─ current valuation and historical performance
  ├─ price refresh orchestration
  └─ dashboard/source-account read models
             │
             ▼
Domain modules
  ├─ Import Draft and reconciliation rules
  ├─ snapshot/event → current Portfolio State
  ├─ identity matching
  └─ EUR valuation
             │
             ▼
Infrastructure adapters
  ├─ SQLite repository
  ├─ MinerU Precision OCR
  ├─ Trading 212 read-only client
  ├─ Eastmoney fund NAV client
  └─ ECB FX client
```

目录含义：

- `src/domain/`：不依赖 React、Next.js 或 SQLite 的业务规则。
- `src/application/`：把领域事实组织成具体用例和前端 read model。
- `src/infrastructure/`：外部系统与持久化适配器。
- `src/app/api/`：很薄的 HTTP seam，负责输入校验和响应。
- `src/components/`：客户端交互与展示。
- `tests/`：按照 domain、application、infrastructure、integration 四层验证。

## 3. 三类核心数据

### 3.1 Import Draft：尚未确认的输入

相关类型位于 `src/domain/imports.ts`。

Import Draft 保存 OCR、CSV、API 或手工输入的解释结果。每个字段都是 `DraftValue<T>`：

- `known`：来源明确，例如 OCR、CSV 或 API。
- `inferred`：系统根据其他字段推算，同时保留推算原因。
- `unknown`：必须由用户补充，不能直接 materialize 成持仓事实。

这样做的原因是：OCR 不完整时不能用空字符串或零值伪装成真实数据。

Import Draft 包含：

- Source Account
- 来源类型
- 截止时间
- 待确认 holdings
- 可选 Portfolio Cash
- warnings
- reconciliation 结果

Draft 保存到 SQLite，但不会参与首页估值。只有 `confirmImport` 成功后才会生成 Confirmed Import 和 Holding State Snapshot。

### 3.2 Holding State：确认后“持有什么”

相关类型位于 `src/domain/portfolio/types.ts`，重建逻辑位于 `src/domain/portfolio/ledger.ts`。

Holding State 包含：

- `Position.quantity`
- `Position.costBasis`
- `Position.reportedPriorReturn`
- 可选资产元数据和最后一次来源价格
- Source Account 内的 Portfolio Cash

系统不直接把 current state 当作唯一事实保存。SQLite 保存按时间排列的 snapshots；`buildPortfolioState` 读取每个 Source Account 最新 snapshot，再应用 snapshot 之后的 Portfolio Events，重建当前状态。

目前 Portfolio Event 的领域模型只实现了 sale。数据库已经有 event 表，但前端尚未提供完整的买入、分红、费用和转账事件录入流程。

### 3.3 Market Data：价格与汇率观察

相关类型位于 `src/domain/market-data.ts`。

Market Data 独立存储：

- `MarketPriceObservation`：按 Source Account + instrument + 日期 + source 标识的价格/NAV。
- `FxRateObservation`：某一日期一单位原币等于多少 EUR。
- `MarketRefreshRecord`：一次批量刷新成功、未变化和失败的统计。

价格观察包含两个不同时间：

- `asOf`：价格或 NAV 属于哪一个市场日期。
- `recordedAt`：本应用什么时候拿到这条数据。

这一区分对 QDII 很重要：7 月 24 日打开应用时，最新可用 NAV 可能仍属于 7 月 23 日，而这条 NAV 可能到 7 月 24 日或 25 日才被发布和记录。

## 4. 时间字段的含义

项目里容易混淆的时间有四种：

| 字段 | 含义 |
| --- | --- |
| snapshot `asOf` | Source Account 的 Holding State 在什么时候有效 |
| price/NAV `asOf` | 价格属于哪个市场日期 |
| `recordedAt` | 应用什么时候获得该市场数据 |
| `confirmedAt` | 用户什么时候确认 Import Draft |

不能用 `recordedAt` 代替 NAV 日期，也不能因为 NAV 晚一天发布就把它当成当天的新自然日价格。

`marketDataTimelineTime` 将“日期型市场观察”放在该 UTC 日期的日末，并限制在当前查询时间以内。Holding history 和 portfolio history 共用这个函数，避免两套日末规则逐渐不一致。

## 5. 导入工作模式

### 5.1 Alipay 截图

调用链：

```text
PNG/JPEG/WebP
  → POST /api/imports/analyze
  → MinerU Precision signed upload
  → poll batch result
  → download ZIP in memory
  → extract full.md
  → parseAlipayHoldingsMarkdown
  → ScreenshotExtraction
  → prepareScreenshotImport
  → Import Draft
  → user review
  → POST /api/imports/:id/confirm
  → confirmed Holding State Snapshot
```

关键文件：

- `src/infrastructure/mineru/mineru-ocr-provider.ts`
- `src/application/imports/ocr-vision-extractor.ts`
- `src/application/imports/alipay-ocr-parser.ts`
- `src/application/imports/vision-extractor.ts`
- `src/app/api/imports/analyze/route.ts`

隐私边界：

- MinerU token 只从服务端环境变量读取。
- 原图、signed URL、结果 ZIP 和 OCR Markdown 不写入本地数据库。
- MinerU 是云端处理方，因此用户仍需接受图片离开本机这一事实。
- OCR 结果必须进入 review，不能直接更新 portfolio。

截图被定义为 **detected-holdings update**：

- review 只展示本次截图实际识别出的基金。
- 数据库中同一 Alipay Source Account 的其他已确认基金不会被追加到 review。
- 确认时，repository 会在 transaction 前把本次更新与最新 confirmed state 合并；截图未涉及的持仓自动保持不变。
- 因此“一张单基金截图”既不会在 review 中冒出其他基金，也不会在确认后删除其他基金。

### 5.2 CSV 与手工输入

CSV parser 会验证：

- 必需列
- Source Account 是否匹配
- instrument code 是否重复
- quantity × NAV 是否等于 current value
- cost basis + prior return 是否等于 current value

CSV 和 manual 仍沿用原有 partial-review 模式：既有持仓会进入完整 review，允许用户明确移除不再持有的项目。这个行为与单基金截图不同，是为了保持当前已实现的 CSV 管理能力。

### 5.3 Trading 212

Trading 212 adapter 只调用：

- `GET /equity/account/summary`
- `GET /equity/positions`

API response 被转换成一个完整 account snapshot，然后与最新 Holding State reconciliation：

- quantity、Cost Basis、cash 都没变：只保存 Market Data，不打开 review。
- 有持仓变化：生成 Import Draft。
- API 中新增：`new`。
- 数量或成本变化：`holding-changed`。
- 旧持仓在完整 API snapshot 中缺失：`possibly-removed`。
- 用户修正过的 ETF/asset type 和 Reported Prior Return 不会被下一次 sync 覆盖。

当同一次完整 snapshot 包含新 holding 或 cash change 时，既有的 price-only holding 仍会随 draft 一起 materialize，以免完整 snapshot 丢失它们。它们的 `Reported Prior Return` 是开始监控时冻结的历史事实，而 `reportedMarketValue` 是最新值，因此两者在后续价格变化后不再满足 `costBasis + reportedPriorReturn = reportedMarketValue`。Confirm route 仍校验每行 `quantity × price`，并继续对新 holding 执行完整 accounting 校验，但不会用首次导入等式拒绝已经跟踪的 Trading 212 holding。

## 6. Snapshot、reconciliation 与确认

`prepareImportDraftForReview` 负责把新 draft 与 current Portfolio State 比较。匹配身份使用：

- Source Account
- instrument id
- instrument code/ISIN/ticker
- 大小写归一化

`reconcileImportDraft` 只把 quantity、Cost Basis 和 currency 的改变算作 Holding State change；NAV、market value 或 price date 的变化属于 `market-data-updated`。

确认时：

1. HTTP route 用 Zod 校验可编辑值。
2. `applyImportDraftReview` 保留未被用户修改字段的原始来源信息。
3. repository 再次读取最新 facts，避免使用过时 current state。
4. screenshot draft 通过 `materializeConfirmedImportSnapshot` 自动补齐未被截图覆盖的既有持仓。
5. 在一个 SQLite transaction 中更新 draft、插入 Confirmed Import、插入 snapshot 并标记 confirmed。

用户重复确认同一个 draft 时，repository 返回已经确认的记录，不重复写入。

## 7. 当前估值

当前估值路径：

```text
latest confirmed Portfolio State
  + latest applicable price per holding
  + latest FX per currency
  → valuePortfolio
  → createDashboardReadModel
  → PortfolioOverviewReadModel
```

`valuePortfolio` 位于 `src/domain/portfolio/valuation.ts`：

- 原币价值优先使用来源报告的 `reportedMarketValue`，避免 quantity × rounded NAV 的小数误差。
- 否则使用 `quantity × unit price`。
- EUR value = original value × `eurPerUnit`。
- Portfolio Cash 只乘 FX，不需要证券价格。
- 缺少价格或 FX 的持仓进入 `missingInputs`，不会伪造估值。
- 价格匹配包含 Source Account，防止两个账户拥有相同 instrument id 时误用另一账户的价格。

## 8. Today、7 days 与 30 days

### 8.1 Today 的真实语义

对于异步市场，所有 holding 不一定拥有相同的最新价格日期。因此 Today 采用：

> 每个 holding 的最新可用日变化，再把这些 holding changes 聚合成 portfolio Today。

对一个已有至少两个价格点的 holding：

1. `current` 使用最新价格/NAV和当前可用 FX。
2. baseline 优先选择最近一个 `priceAsOf` 不同的价格/NAV；baseline FX 使用 current 之前最近一次 valuation 的汇率。这样既包含最新 NAV 日变化，也不会因为 NAV 延迟而把多天汇率变化重复算入 Today。
3. 如果只有一个价格点，则允许用前一个 valuation point 计算 FX-only change。
4. baseline 与 current 距离超过四天时，Today 不可用，避免把很旧的数据冒充日变化。

QDII 示例：

```text
7/24 查看组合
最新 QDII NAV：7/23
上一份 QDII NAV：7/22
最新 EUR/CNY：可到 7/24

Today = 7/23 NAV 相对 7/22 NAV 的价格影响
      + 当前汇率相对前一次 valuation 汇率的 FX 影响
```

所以 QDII 不会因为 NAV 比欧美市场慢一天就只显示汇率变化。holding 行仍显示实际使用的 NAV 日期，让用户能看出数据滞后。

价格与汇率分解：

```text
priceChange = quantity × (currentPrice - baselinePrice) × baselineFx
fxChange    = quantity × currentPrice × (currentFx - baselineFx)
totalChange = priceChange + fxChange
```

`combinePortfolioPeriodHistory` 强制顶部 Today change 等于所有 available holding Today changes 的总和，并产生 `[baseline total, current total]` 两点组合曲线。这样顶部数字和每行数字不会再由两套 Today 口径计算。

### 8.2 7 days 与 30 days

较长区间使用 `selectRangeBaseline`：

- 7 days 目标 baseline 允许最多三天容差。
- 30 days 目标 baseline 允许最多七天容差。
- 如果监控本身晚于目标日期，则使用最早真实 observation，并标记 `coverage: partial`。
- 如果已有很长历史但目标附近没有可信点，则保持 unavailable。

Portfolio history 会重建每个历史时间点的 state，并把历史 value 归一到当前 quantity，避免把新增份额或新持仓错误当成投资收益。

## 9. 前端 read model 与 UI

`src/application/portfolio-read-model.ts` 是前端主要 interface。React 不直接读取领域 snapshot 或 SQLite row。

首页拿到：

- total EUR value
- holding display fields
- original-currency value
- calculated total return
- Today/7-day/30-day performance
- price/FX attribution
- price history
- source-account status
- market refresh status
- EUR/CNY overview
- locally calculated Portfolio insights：集中度、持仓计价币种/资产类别分布、近期贡献和数据质量

`src/application/portfolio-insights.ts` 只消费已经估值完成的 `PortfolioOverviewReadModel`，不读取 SQLite、截图或 provider credentials。这里的 holding currency 是证券计价币种，不代表基金底层资产的 look-through currency exposure。它生成稳定的结构化事实，首页直接展示；未来 LLM brief 也应只消费这个边界，而不能自行重新计算收益或读取原始个人数据。

`src/components/dashboard.tsx` 负责：

- period 和 Source Account 过滤
- portfolio 与 holding sparklines
- holding detail drawer
- 手工 dated price 输入
- NAV refresh
- demo/local data 隔离

小图先把每只 holding 转换成相对自身 baseline 的百分比变化，再使用同一 Y 轴范围，因此不同规模的基金可以视觉比较。

`src/components/screenshot-import.tsx` 负责：

- 选择 Source Account 和输入方式
- 上传与 OCR 进度
- editable draft
- reconciliation 状态
- confirmation

前端没有权限绕过 confirmation；真正写入 snapshot 的 gate 在服务端 repository。

## 10. SQLite 持久化

默认文件是 `data/invest-assets-monitor.sqlite`，可通过 `PORTFOLIO_DB_FILENAME` 改变 basename。整个数据库被 Git 忽略。

| 表 | 作用 |
| --- | --- |
| `schema_metadata` | 当前 schema version |
| `import_drafts` | 可编辑 draft 和状态 |
| `confirmed_imports` | confirmation audit record |
| `opening_snapshots` | opening/holding-state snapshot JSON |
| `portfolio_events` | 已确认经济事件；当前主要预留给 sale/event 扩展 |
| `market_price_observations` | 本地价格/NAV历史 |
| `fx_observations` | 本地汇率历史 |
| `market_refresh_runs` | 最近刷新统计和失败信息 |
| `source_account_labels` | 用户自定义账户名称 |
| `source_sync_state` | connector cursor/状态预留；当前尚未使用 |

Repository interface 位于 `src/infrastructure/sqlite/portfolio-repository.ts`。它把 SQL、JSON encode/decode、transaction 和 legacy partial snapshot 恢复隐藏在一个模块内。

当前 schema version 是 v2。pre-v2 测试数据库不自动迁移，以避免对早期 disposable 测试数据做不可靠转换。

## 11. 外部适配器

### MinerU

- Precision VLM batch
- signed HTTPS upload
- allowlisted upload/result hosts
- retry、rate limit、deadline 和 response-size 限制
- 只从 ZIP 提取 `full.md`

### Eastmoney

- 使用六位公募基金代码
- 从监控开始日或最新已知 NAV 向后补齐
- 只发送公开 fund code
- provider 失败时保留旧价格

### ECB

- 读取每日 EUR reference rates
- 转换成“一单位原币值多少 EUR”
- dashboard 请求中有六小时进程内 cache
- 每次成功读取会 upsert dated FX observations

### Trading 212

- Demo/Live 环境分离
- Basic credential 只在服务端
- 两个只读 endpoint
- 401/403、429 和通用失败有不同错误说明

首页 `Refresh prices` 也会读取 Trading 212 snapshot，但只将已确认 position 对应的当前价格转换成 Market Data Observation。新持仓、quantity、Cost Basis 与 cash 不会通过价格刷新写入 Holding State；这些变化仍必须走 `Update assets → Sync Trading 212` 的 reconciliation/confirmation gate。

Dashboard 首次读取到非空本地组合后，会调用 `/api/market-data/refresh?mode=automatic`。Route 使用 `MarketRefreshRecord.completedAt` 的 Helsinki 日历日期作为幂等门槛：当天已有完成记录则立即返回，不调用 Eastmoney 或 Trading 212；跨入新的 Helsinki 日期后才再次执行。手工刷新使用 `mode=manual`，明确绕过该门槛。两种模式最终进入同一个 refresh implementation，因此自动化没有另一套估值或写入规则。

## 12. 测试策略

测试不使用真实 portfolio data：

- `tests/domain/`：ledger、valuation、draft materialization。
- `tests/application/`：parser、history、read model、refresh、sparkline。
- `tests/infrastructure/`：用 fake fetch 验证外部 adapter。
- `tests/integration/`：内存 SQLite 和 route handler 的完整用例。

两个关键回归约束：

- QDII 的 Today 在 FX 日期比 NAV 新时仍包含最近 NAV move。
- 单基金 screenshot draft 只显示检测出的基金，但 confirmation 后 omitted holdings 仍存在。

标准验证命令：

```bash
npm test
npm run typecheck
npm run build
```

## 13. 当前限制与后续演进

- 没有后台 scheduler；价格刷新仍由用户触发。
- Portfolio insights 的确定性事实层已经实现；可选 LLM narrative/provider adapter 尚未接入。
- QDII 的“Today”是 latest available daily move，不等于尚未发布的实时 7/24 NAV。应用不能计算一个市场尚未公布的价格。
- Portfolio Event 目前只有 sale domain model，尚无完整 UI/API 工作流。
- OCR parser 目前只针对 Alipay 中文基金标签。
- MinerU 是云端 OCR，不是纯本地 OCR。
- SQLite repository 目前使用 JSON payload 保存 draft/snapshot，灵活但不适合复杂 SQL 分析；如果未来增加大量 transaction analytics，应考虑规范化 event/position fact tables。
- `dashboard.tsx` 和 `screenshot-import.tsx` 仍是较大的交互模块。当前 cleanup 没有强行拆分它们，因为状态、focus management 和表单编辑高度耦合；在缺少 component-level interaction tests 时大拆分的回归风险高于收益。

## 14. 修改功能时从哪里开始

- 改持仓/成本规则：`src/domain/portfolio/`
- 改 import/reconciliation：`src/domain/imports.ts`
- 改 OCR 字段识别：`src/application/imports/alipay-ocr-parser.ts`
- 改 Today/holding history：`src/application/holding-history.ts`
- 改 portfolio period 聚合：`src/application/portfolio-periods.ts`
- 改 Portfolio insights：`src/application/portfolio-insights.ts`
- 改 7/30 天历史重建：`src/application/portfolio-dashboard.ts`
- 改 SQLite：`src/infrastructure/sqlite/`
- 改首页展示：`src/components/dashboard.tsx`
- 改 review UI：`src/components/screenshot-import.tsx`

建议继续保持“先在正确 seam 写最小回归测试，再改 implementation”的工作方式。尤其是时间、价格、FX、quantity 和 partial import 的组合，很容易产生表面合理但口径不一致的结果。
