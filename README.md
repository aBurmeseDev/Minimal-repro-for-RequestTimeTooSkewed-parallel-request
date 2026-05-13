RequestTimeTooSkewed not auto-corrected for parallel requests

## Repro

This is a pure Node.js repro — no Electron/Tauri needed. The bug might be in the `errorHandler` logic in `AwsSdkSigV4Signer`, not runtime-specific.

Issue: https://github.com/aws/aws-sdk-js-v3/issues/8005

### Setup

```bash
npm install
```

### Run

```bash
# Reproduce the bug
node index.js

# Confirm the workaround fixes it
node index.js --workaround
```

### Expected

All 5 parallel requests succeed (SDK corrects skew and retries all of them).

### Current

1 request succeeds (the first one to trigger clock correction), 4 fail with `SignatureDoesNotMatch`.

## How it works

The script creates an STS client with `systemClockOffset: 7200000` (2 hours ahead), then fires 5 parallel `GetCallerIdentity` requests. All 5 will get clock-skew errors. The SDK's error handler should correct the offset and set `clockSkewCorrected = true` so the retry logic kicks in for all of them. The bug is that only the first request to reach the error handler gets retried.

Uses `GetCallerIdentity` since it requires no special permissions or resources.

## Potential Root cause

In `AwsSdkSigV4Signer.errorHandler()`, the check was:

```typescript
const clockSkewCorrected =
	config.systemClockOffset !== initialSystemClockOffset;
```

After the first request corrects the offset, subsequent requests see `initialSystemClockOffset` (read from the now-corrected `config.systemClockOffset`) equal to the updated value, so `clockSkewCorrected = false` and they don't retry.
