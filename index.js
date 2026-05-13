/**
 * Minimal repro for #8005: RequestTimeTooSkewed not auto-corrected for parallel requests.
 *
 * Uses ListBuckets (no bucket or write permissions needed).
 *
 * Usage:
 *   npm install
 *   node index.js
 */

const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

const REGION = process.env.AWS_REGION || "us-east-1";
const PARALLEL_COUNT = 5;
// 2 hours in the future — guaranteed to trigger RequestTimeTooSkewed
const SKEW_MS = 2 * 60 * 60 * 1000;

const USE_WORKAROUND = process.argv.includes("--workaround");

async function main() {
	const client = new STSClient({
		region: REGION,
		systemClockOffset: SKEW_MS,
	});

	if (USE_WORKAROUND) {
		client.middlewareStack.add(
			(next, context) => {
				return async (args) => {
					try {
						return await next(args);
					} catch (error) {
						if (
							error.name !== "RequestTimeTooSkewed" &&
							error.name !== "SignatureDoesNotMatch"
						) {
							throw error;
						}
						return await next(args);
					}
				};
			},
			{
				name: "clock_skew_handler",
				priority: "low",
			},
		);
		console.log("*** Workaround middleware applied ***\n");
	}

	console.log(
		`Sending ${PARALLEL_COUNT} parallel GetCallerIdentity requests with ${SKEW_MS}ms clock skew...`,
	);
	console.log(`Region: ${REGION}\n`);

	const promises = Array.from({ length: PARALLEL_COUNT }, (_, i) => {
		return client
			.send(new GetCallerIdentityCommand({}))
			.then(() => ({ index: i, status: "success" }))
			.catch((err) => ({
				index: i,
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
			console.log(`  [${r.index}] SUCCESS`);
		} else {
			failures++;
			console.log(`  [${r.index}] FAILED  — ${r.error}: ${r.message}`);
		}
	}

	console.log(`\nSummary: ${successes} succeeded, ${failures} failed`);

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
