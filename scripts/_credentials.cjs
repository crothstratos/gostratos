/**
 * Turns Google's credential errors into the command that fixes them.
 *
 * Application Default Credentials expire, and when they do every script here
 * fails with the same wall of text: "400 undefined: Getting metadata from
 * plugin failed with error: invalid_grant ... invalid_rapt". Nothing in that
 * says what to do, and it has now sent two separate debugging sessions after
 * an imagined problem with the script.
 *
 * The two are different and the difference matters, because doing the wrong
 * one leaves the error exactly as it was:
 *
 *   gcloud auth login                      signs in the gcloud command itself
 *   gcloud auth application-default login  signs in code that runs locally
 *
 * Scripts use the second. Deploys use the first. Having done one does not do
 * the other, which is why deploys keep working while scripts stop.
 */

const CREDENTIAL_PATTERNS = [
  /invalid_grant/i,
  /invalid_rapt/i,
  /reauth related error/i,
  /Could not load the default credentials/i,
  /Getting metadata from plugin failed/i,
  /UNAUTHENTICATED/i,
  /Request had invalid authentication credentials/i,
];

const PERMISSION_PATTERNS = [
  /PERMISSION_DENIED/i,
  /Missing or insufficient permissions/i,
  /caller does not have permission/i,
];

/** Prints a useful message and exits. Never returns. */
function explainAndExit(err) {
  const message = String((err && err.message) || err);

  if (CREDENTIAL_PATTERNS.some((re) => re.test(message))) {
    console.error('\n  Your Google credentials have expired.\n');
    console.error('  Run this, then try again:\n');
    console.error('      gcloud auth application-default login\n');
    console.error('  Note "application-default" — that is the one local scripts use.');
    console.error('  Plain `gcloud auth login` signs in the gcloud command instead, which');
    console.error('  is why deploys keep working while this does not.\n');
    console.error(`  (original error: ${message.slice(0, 200)})\n`);
    process.exit(1);
  }

  if (PERMISSION_PATTERNS.some((re) => re.test(message))) {
    console.error('\n  Signed in, but this account cannot read that database.\n');
    console.error('  Check you are signed in as an account with Firestore access:\n');
    console.error('      gcloud auth application-default login\n');
    console.error(`  (original error: ${message.slice(0, 200)})\n`);
    process.exit(1);
  }

  console.error('\nFailed:', message, '\n');
  process.exit(1);
}

module.exports = { explainAndExit };
