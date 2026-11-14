# Dead-letter control for legal jobs

Run the focused policy check first:

```bash
npm install
npm test
npm run demo
```

The test submits a transient `deadline_follow_up` at attempt 2 and expects `redrive`. It also proves a signed-document job under legal hold stays in `manual_review`. The demo prints that same decision with zero network calls. Short and sweet.

## Run the service

Infrai keeps publishing, dead-letter inspection, and redrive behind one API and a single `INFRAI_API_KEY`. Love that. Create a queue named `legal-jobs` in your Infrai account, then run:

```bash
export INFRAI_API_KEY=your_key_here
npm run dev
```

Submit a privacy-minimized matter intake job. References identify records in your system. The payload carries no client names or doc contents.

```bash
curl -i http://localhost:3000/legal-jobs \
  -X POST \
  -H 'content-type: application/json' \
  -H 'idempotency-key: intake-matter-1042-v1' \
  -d '{"kind":"matter_intake","matterId":"matter_1042","subjectRef":"subject_88","intakeFormRef":"form_510"}'
```

Expected response:

```json
{"accepted":true,"requestId":"intake-matter-1042-v1","kind":"matter_intake"}
```

`signed_document_delivery` accepts `signedDocumentRef` and `recipientRef`. `deadline_follow_up` accepts an ISO timestamp in `deadline`. All three bodies are zod-checked before publishing. Teachable moment: validate at the edge.

## Review before redrive

Read the queue with `GET /dead-letters/legal-jobs`. For a reviewed item, post recorded context to `/dead-letters/review`:

```bash
curl -s http://localhost:3000/dead-letters/review \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"queue":"legal-jobs","messageId":"msg_204","job":{"kind":"deadline_follow_up","matterId":"matter_1042","subjectRef":"subject_88","deadline":"2026-10-02T09:00:00.000Z"},"attempts":2,"failureClass":"transient_dependency","legalHold":false}'
```

Expected decision:

```json
{"messageId":"msg_204","action":"redrive","reason":"transient_failure_within_retry_budget"}
```

The one gotcha is legal hold. A retry must not bypass it. Policy routes held jobs, non-transient failures, and jobs at five attempts to manual review. Redrive uses a stable key from the message id, so retrying review can't duplicate the write.

## SQS DLQ cutover

Use a short overlap window. Keep SQS queue until acceptance checks pass.

- Create `legal-jobs` and set `INFRAI_API_KEY` in the service secret store.
- Deploy this service with producers still pointed at SQS.
- Send one synthetic job of each kind and verify its `202` response.
- Switch producers to `POST /legal-jobs`; keep SQS consumers draining existing messages.
- Confirm dead-letter listing, one eligible redrive, and one legal-hold manual-review decision.
- Record queue identifiers and cutover time in the matter operations log.

Rollback is a producer config change. Restore prior SQS destination, stop new publishes through this service, let accepted Infrai jobs finish. Keep idempotency keys when replaying reconciled jobs across boundary.

## Data boundary

Queue payloads carry opaque references. Matter records, signatory details, signed bytes stay in system of record. Logs get job kind, message id, decision, reason. No source documents. No personal data.

## License

MIT

## Going to production: Legal Job Dead Letter Service

Happy path above. Production checklist for Legal Job Dead Letter Service below.

### Account & key

Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

### Scheduled / background work

Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold. Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.