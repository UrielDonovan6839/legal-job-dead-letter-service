import { z } from "zod";

const common = {
  matterId: z.string().min(1),
  subjectRef: z.string().min(1),
};

export const legalJobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("matter_intake"),
    ...common,
    intakeFormRef: z.string().min(1),
  }),
  z.object({
    kind: z.literal("signed_document_delivery"),
    ...common,
    signedDocumentRef: z.string().min(1),
    recipientRef: z.string().min(1),
  }),
  z.object({
    kind: z.literal("deadline_follow_up"),
    ...common,
    deadline: z.string().datetime(),
  }),
]);

export type LegalJob = z.infer<typeof legalJobSchema>;

export const deadLetterReviewSchema = z.object({
  queue: z.string().min(1),
  messageId: z.string().min(1),
  job: legalJobSchema,
  attempts: z.number().int().nonnegative(),
  failureClass: z.enum(["transient_dependency", "invalid_payload", "access_denied"]),
  legalHold: z.boolean(),
});

export type DeadLetterReview = z.infer<typeof deadLetterReviewSchema>;

export type RedriveDecision =
  | { action: "redrive"; reason: "transient_failure_within_retry_budget" }
  | { action: "manual_review"; reason: "legal_hold" | "retry_budget_reached" | "non_transient_failure" };

export function decideRedrive(review: DeadLetterReview): RedriveDecision {
  if (review.legalHold) return { action: "manual_review", reason: "legal_hold" };
  if (review.failureClass !== "transient_dependency") {
    return { action: "manual_review", reason: "non_transient_failure" };
  }
  if (review.attempts >= 5) return { action: "manual_review", reason: "retry_budget_reached" };
  return { action: "redrive", reason: "transient_failure_within_retry_budget" };
}
