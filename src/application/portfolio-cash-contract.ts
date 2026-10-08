import { z } from "zod";

export const externalDestinationSchema = z.object({ kind: z.literal("external-account"), name: z.string().trim().min(1, "Enter a destination account name.").max(100) }).strict();
export const cashDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("investment-account") }).strict(),
  externalDestinationSchema,
]);

// Drafts may contain incomplete values. Final confirmation checks completeness.
export const importReductionReviewSchema = z.discriminatedUnion("kind", [
  z.object({ instrumentId: z.string().min(1).max(200), quantity: z.string().max(100), kind: z.literal("sale"), proceeds: z.string().max(100), fees: z.string().max(100),
    destination: z.discriminatedUnion("kind", [z.object({ kind: z.literal("investment-account") }), z.object({ kind: z.literal("external-account"), name: z.string().max(100) })]),
  }),
  z.object({ instrumentId: z.string().min(1).max(200), quantity: z.string().max(100), kind: z.literal("adjustment"), reason: z.string().max(300) }),
]);
