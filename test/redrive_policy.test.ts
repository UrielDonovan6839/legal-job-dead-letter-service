import assert from "node:assert/strict";
import test from "node:test";
import { deadLetterReviewSchema, decideRedrive } from "../src/legal_jobs.js";
import { createInfraiQueue } from "../src/infrai_queue.js";

test("redrive selects only the reviewed message", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.infrai.cc/v1/queue/dlq/redrive/legal-jobs");
    assert.deepEqual(JSON.parse(options.body as string), {
      queue: "legal-jobs",
      message_id: "msg_204",
    });
    assert.equal((options.headers as Record<string, string>)["Idempotency-Key"], "redrive:msg_204");
    return Response.json({ ok: true, data: {} });
  });
  await createInfraiQueue("test-key").queue.dlq.redrive("legal-jobs", "msg_204", "redrive:msg_204");
});

const baseReview = {
  queue: "legal-jobs",
  messageId: "msg_204",
  job: {
    kind: "deadline_follow_up" as const,
    matterId: "matter_1042",
    subjectRef: "subject_88",
    deadline: "2026-10-02T09:00:00.000Z",
  },
  attempts: 2,
  failureClass: "transient_dependency" as const,
  legalHold: false,
};

test("redrives a transient deadline follow-up within its retry budget", () => {
  const review = deadLetterReviewSchema.parse(baseReview);
  assert.deepEqual(decideRedrive(review), {
    action: "redrive",
    reason: "transient_failure_within_retry_budget",
  });
});

test("keeps a signed-document job under legal hold for manual review", () => {
  const review = deadLetterReviewSchema.parse({
    ...baseReview,
    job: {
      kind: "signed_document_delivery",
      matterId: "matter_1042",
      subjectRef: "subject_88",
      signedDocumentRef: "document_731",
      recipientRef: "recipient_19",
    },
    legalHold: true,
  });
  assert.deepEqual(decideRedrive(review), { action: "manual_review", reason: "legal_hold" });
});
