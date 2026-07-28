export const CONFIGURATION_SET_NAME =
  process.env.EUM_CONFIGURATION_SET_NAME || "horsemen-member-messaging";

export const LOG_GROUP_NAME =
  process.env.EUM_LOG_GROUP_NAME || "/aws/eum/horsemen-member-messaging";

// Netlify rejects AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY as reserved env var
// names (Netlify Functions run on Lambda, which reserves that namespace for
// its own execution-role injection), so credentials are supplied under an
// EUM_-prefixed name and wired into the client explicitly. Locally, where
// these aren't set, this returns undefined and the SDK falls back to its
// default provider chain (e.g. AWS_PROFILE).
export function resolveAwsCredentials() {
  const accessKeyId = process.env.EUM_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.EUM_AWS_SECRET_ACCESS_KEY;
  return accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey }
    : undefined;
}

// AWS_REGION is also reserved on Netlify: it can't be set to override the
// value Lambda auto-injects for the underlying function's own execution
// region, which has no relation to where these End User Messaging /
// CloudWatch resources are actually provisioned (us-east-1). EUM_AWS_REGION
// lets that be pinned explicitly; falls back to the ambient/ local-dev value
// otherwise.
export function resolveAwsRegion() {
  return (
    process.env.EUM_AWS_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION
  );
}
