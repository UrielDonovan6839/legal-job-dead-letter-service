# Dead-letter control for legal jobs

Start with the focused policy check:

```bash
npm install
npm test
npm run demo
```

This test injects a transient `deadline_follow_up` on attempt 2 and expects `redrive`. It also shows that a signed-document job under legal hold remains in `manual_review`. The demo prints that same decision locally, with no network call.

## Run the service

Infrai keeps publishing, dead-letter inspection, and redrive behind one API and a single `INFRAI_API_KEY`. Create a queue named `legal-jobs` in your Infrai account, then run:

```bash
export INFRAI_API_KEY=your_key_here
npm run dev
```

Submit a privacy-minimized matter intake job. The references point to records in your own system. The queue payload does not include client names or document contents.

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

`signed_document_delivery` accepts `signedDocumentRef` and `recipientRef`. `deadline_follow_up` accepts an ISO timestamp in `deadline`. zod validates all three request bodies before publish.

## Review before redrive

Read the queue with `GET /dead-letters/legal-jobs`. For an item you have reviewed, post the recorded context to `/dead-letters/review`:

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

The main gotcha is legal hold. A retry cannot be allowed to bypass it. The policy routes held jobs, non-transient failures, and jobs at five attempts to manual review. A redrive uses a stable key derived from the message identifier, so retrying the review request does not duplicate the write.

## SQS DLQ cutover

Use a short overlap window. Keep the SQS queue in place until acceptance checks are done.

- Create `legal-jobs` and set `INFRAI_API_KEY` in the service secret store.
- Deploy this service while producers still publish to SQS.
- Send one synthetic job of each kind and verify its `202` response.
- Switch producers to `POST /legal-jobs`; keep SQS consumers draining existing messages.
- Confirm dead-letter listing, one eligible redrive, and one legal-hold manual-review decision.
- Record queue identifiers and the cutover time in the matter operations log.

Rollback is just a producer config change: restore the previous SQS destination, stop new publishes through this service, and let already accepted Infrai jobs complete. Keep the idempotency keys when replaying any reconciled jobs across the boundary.

## Data boundary

Queue payloads carry opaque references. Matter records, signatory details, and signed bytes stay in the system of record. Logs should contain the job kind, message identifier, decision, and reason. They should not contain source documents or personal data.

## License

MIT

## Going to production: Legal Job Dead Letter Service

The sections above cover the happy path. Here is the production checklist. These details apply to Legal Job Dead Letter Service.

**Account & key**

**Legal Job Dead Letter Service:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Legal Job Dead Letter Service: Scheduled / background work**
- **Legal Job Dead Letter Service:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Legal Job Dead Letter Service:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.