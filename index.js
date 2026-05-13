/**
 *
 * Setup:
 *   1. Set your system clock 1+ hour ahead/behind, OR
 *   2. Use the approach below: inject a large systemClockOffset to simulate skew.
 *
 * Usage:
 *   npm install
 *   export AWS_REGION=us-east-1
 *   export BUCKET_NAME=your-test-bucket
 *   node index.js
 */

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.BUCKET_NAME;
const PARALLEL_COUNT = 5;
// 2 hours in the future — guaranteed to trigger RequestTimeTooSkewed
const SKEW_MS = 2 * 60 * 60 * 1000;

if (!BUCKET) {
	console.error(
		"Set BUCKET_NAME env var to an S3 bucket you have PutObject access to.",
	);
	process.exit(1);
}

async function main() {
	const client = new S3Client({
		region: REGION,
		// Inject a wrong clock offset to simulate a skewed system clock.
		// The SDK should detect the skew from the first error, correct the offset,
		// and retry ALL parallel requests — not just the first one.
		systemClockOffset: SKEW_MS,
	});

	console.log(
		`Sending ${PARALLEL_COUNT} parallel PutObject requests with ${SKEW_MS}ms clock skew...`,
	);
	console.log(`Bucket: ${BUCKET}, Region: ${REGION}\n`);

	const promises = Array.from({ length: PARALLEL_COUNT }, (_, i) => {
		const key = `clock-skew-repro/test-${i}-${Date.now()}.txt`;
		return client
			.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: key,
					Body: `test object ${i}`,
				}),
			)
			.then(() => ({ index: i, key, status: "success" }))
			.catch((err) => ({
				index: i,
				key,
				status: "failed",
				error: err.name,
				message: err.message,
			}));
	});

	const results = await Promise.all(promises);

	console.log("Results:");
	console.log("--------");
	let successes = 0;
	let failures = 0;
	for (const r of results) {
		if (r.status === "success") {
			successes++;
			console.log(`  [${r.index}] SUCCESS — ${r.key}`);
		} else {
			failures++;
			console.log(`  [${r.index}] FAILED  — ${r.error}: ${r.message}`);
		}
	}

	console.log(`\nSummary: ${successes} succeeded, ${failures} failed`);
	console.log(`Final systemClockOffset: ${client.config.systemClockOffset}`);

	if (failures > 0) {
		console.log(
			"\n*** BUG REPRODUCED: parallel requests failed because clock-skew retry",
		);
		console.log(
			"    only triggered for the first request. The rest were not retried.",
		);
	} else {
		console.log(
			"\n*** All requests succeeded — bug may be fixed in this SDK version.",
		);
	}
}

main().catch(console.error);
