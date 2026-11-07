import { deadLetterReviewSchema, decideRedrive } from "./legal_jobs.js";

const review = deadLetterReviewSchema.parse({
  queue: "legal-jobs",
  messageId: "msg_demo_001",
  job: {
    kind: "signed_document_delivery",
    matterId: "matter_1042",
    subjectRef: "subject_88",
    signedDocumentRef: "document_731",
    recipientRef: "recipient_19",
  },
  attempts: 2,
  failureClass: "transient_dependency",
  legalHold: false,
});

console.log(JSON.stringify({ messageId: review.messageId, ...decideRedrive(review) }, null, 2));
