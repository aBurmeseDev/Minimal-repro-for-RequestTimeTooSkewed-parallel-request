# Issue #8005 - RequestTimeTooSkewed not auto-corrected for parallel requests

## Repro

This is a pure Node.js repro — no Electron/Tauri needed. The bug is in the SDK's `errorHandler` logic in `AwsSdkSigV4Signer`, not runtime-specific.

### Setup

```bash
npm install
export AWS_REGION=us-east-1
export BUCKET_NAME=your-test-bucket
```

### Run

```bash
npm run reproduce
```

### Expected

All 5 parallel requests succeed (SDK corrects skew and retries all of them).

### Current

1 request succeeds (the first one to trigger clock correction), 4 fail with `RequestTimeTooSkewed`.

## How it works

The script creates an S3 client with `systemClockOffset: 7200000` (2 hours ahead), then fires 5 parallel `PutObject` requests. All 5 will get `RequestTimeTooSkewed` errors. The SDK's error handler should correct the offset and set `clockSkewCorrected = true` so the retry logic kicks in for all of them. The bug is that only the first request to reach the error handler gets retried.

## Root cause

In `AwsSdkSigV4Signer.errorHandler()`, the check was:

```typescript
const clockSkewCorrected =
	config.systemClockOffset !== initialSystemClockOffset;
```

After the first request corrects the offset, subsequent requests see `initialSystemClockOffset` (read from the now-corrected `config.systemClockOffset`) equal to the updated value, so `clockSkewCorrected = false` and they don't retry.
