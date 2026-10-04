import { z } from "zod";

import type {
  FactualUpdate,
  PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-contract";
import {
  analystLimitationCodes,
} from "@/application/portfolio-analyst-contract";

export const analystClaimClassifications = [
  "fact",
  "calculation",
  "estimate",
  "interpretation",
] as const;

const evidenceKeySchema = z.string().min(1).max(80);
const claimSchema = (maximumTextLength: number) => z.object({
  text: z.string().trim().min(1).max(maximumTextLength),
  classification: z.enum(analystClaimClassifications),
  evidence: z.array(evidenceKeySchema).min(1).max(4),
}).strict();

const limitationSchema = z.object({
  code: z.enum(analystLimitationCodes),
  evidenceKey: evidenceKeySchema,
}).strict();

const factualUpdateSchemas = {
  "refresh-fx": z.object({
    kind: z.literal("refresh-fx"),
    currency: z.string().min(3).max(12),
    reasonEvidenceKey: evidenceKeySchema,
  }).strict(),
  "record-dated-market-data": z.object({
    kind: z.literal("record-dated-market-data"),
    reasonEvidenceKey: evidenceKeySchema,
  }).strict(),
  "configure-danske-route": z.object({
    kind: z.literal("configure-danske-route"),
    reasonEvidenceKey: evidenceKeySchema,
  }).strict(),
  "retry-market-data-refresh": z.object({
    kind: z.literal("retry-market-data-refresh"),
    reasonEvidenceKey: evidenceKeySchema,
  }).strict(),
  "create-account": z.object({
    kind: z.literal("create-account"),
    accountType: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    reasonEvidenceKey: evidenceKeySchema,
  }).strict(),
  "start-account-import": z.object({
    kind: z.literal("start-account-import"),
    accountType: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    reasonEvidenceKey: evidenceKeySchema,
  }).strict(),
} satisfies Record<FactualUpdate["kind"], z.ZodType>;

type FactualUpdateSchema = typeof factualUpdateSchemas[
  keyof typeof factualUpdateSchemas
];
const factualUpdateSchemaValues = Object.values(factualUpdateSchemas) as [
  FactualUpdateSchema,
  FactualUpdateSchema,
  ...FactualUpdateSchema[],
];
export const portfolioAnalystAnswerCandidateSchema = z.object({
  factsAsOf: z.string().min(1).max(64),
  answer: claimSchema(800),
  claims: z.array(claimSchema(400)).max(6),
  limitations: z.array(limitationSchema).max(8),
  proposedUpdate: z.union([...factualUpdateSchemaValues, z.null()]),
}).strict();

export type PortfolioAnalystAnswer = z.infer<
  typeof portfolioAnalystAnswerCandidateSchema
>;

const { $schema: _schemaDialect, ...generatedAnswerJsonSchema } =
  z.toJSONSchema(portfolioAnalystAnswerCandidateSchema);

export const portfolioAnalystAnswerJsonSchema = generatedAnswerJsonSchema;

export const portfolioAnalystConversationalAnswerInstruction =
  "Make answer.text a self-contained conversational response that directly and fully answers the current question, including any material limitations. It must remain useful without opening claims or evidence details; use claims only as a supporting factual breakdown.";

export function projectPartialPortfolioAnalystAnswer(
  json: string,
): string | undefined {
  const match = /"answer"\s*:\s*\{\s*"text"\s*:\s*"/.exec(json);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  let raw = "";
  let escaped = false;
  for (let index = start; index < json.length; index += 1) {
    const character = json[index]!;
    if (!escaped && character === '"') break;
    raw += character;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
  }
  if (escaped) raw = raw.slice(0, -1);
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return undefined;
  }
}

export type PortfolioAnalystAnswerValidationCode =
  | "invalid-structure"
  | "facts-as-of-mismatch"
  | "unknown-evidence"
  | "duplicate-evidence"
  | "limitation-mismatch"
  | "disallowed-action";

export class PortfolioAnalystAnswerValidationError extends Error {
  constructor(readonly code: PortfolioAnalystAnswerValidationCode) {
    super(`Portfolio analyst answer failed validation: ${code}`);
    this.name = "PortfolioAnalystAnswerValidationError";
  }
}

function sameFactualUpdate(
  candidate: FactualUpdate,
  allowed: FactualUpdate,
): boolean {
  if (
    candidate.kind !== allowed.kind ||
    candidate.reasonEvidenceKey !== allowed.reasonEvidenceKey
  ) {
    return false;
  }
  if (candidate.kind === "refresh-fx") {
    return allowed.kind === "refresh-fx" && candidate.currency === allowed.currency;
  }
  if (candidate.kind === "create-account" || candidate.kind === "start-account-import") {
    return allowed.kind === candidate.kind &&
      candidate.accountType === allowed.accountType &&
      candidate.label === allowed.label;
  }
  return true;
}

function validateEvidence(
  answer: PortfolioAnalystAnswer,
  context: PortfolioAnalystContextV1,
): void {
  const available = new Set<string>(context.facts.map((fact) => fact.key));
  for (const claim of [answer.answer, ...answer.claims]) {
    if (new Set(claim.evidence).size !== claim.evidence.length) {
      throw new PortfolioAnalystAnswerValidationError("duplicate-evidence");
    }
    if (claim.evidence.some((key) => !available.has(key))) {
      throw new PortfolioAnalystAnswerValidationError("unknown-evidence");
    }
  }
}

function validateLimitations(
  answer: PortfolioAnalystAnswer,
  context: PortfolioAnalystContextV1,
): void {
  if (
    answer.limitations.length !== context.limitations.length ||
    answer.limitations.some((limitation, index) => {
      const expected = context.limitations[index];
      return !expected ||
        limitation.code !== expected.code ||
        limitation.evidenceKey !== expected.evidenceKey;
    })
  ) {
    throw new PortfolioAnalystAnswerValidationError("limitation-mismatch");
  }
}

export function validatePortfolioAnalystAnswer(input: {
  context: PortfolioAnalystContextV1;
  candidate: unknown;
}): PortfolioAnalystAnswer {
  const parsed = portfolioAnalystAnswerCandidateSchema.safeParse(input.candidate);
  if (!parsed.success) {
    throw new PortfolioAnalystAnswerValidationError("invalid-structure");
  }
  const answer = parsed.data;
  if (answer.factsAsOf !== input.context.factsAsOf) {
    throw new PortfolioAnalystAnswerValidationError("facts-as-of-mismatch");
  }
  validateEvidence(answer, input.context);
  validateLimitations(answer, input.context);
  if (
    answer.proposedUpdate &&
    !input.context.allowedActions.some((allowed) =>
      sameFactualUpdate(answer.proposedUpdate!, allowed)
    )
  ) {
    throw new PortfolioAnalystAnswerValidationError("disallowed-action");
  }
  return answer;
}
