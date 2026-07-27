function parseUsers() {
  const raw = process.env.MESSAGE_USERS_JSON;
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (user) =>
      user &&
      typeof user.name === "string" &&
      typeof user.token === "string" &&
      user.token.length > 0,
  );
}

function extractToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const tokenFromBearer =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

  return (
    tokenFromBearer ||
    event.headers["x-access-code"] ||
    event.headers["X-Access-Code"] ||
    ""
  );
}

// Resolves a request's per-person access code against MESSAGE_USERS_JSON.
// Returns { name } on success, or null if the token is missing, unknown,
// or MESSAGE_USERS_JSON is unset/malformed.
export function authenticate(event) {
  const token = extractToken(event);
  if (!token) return null;

  const users = parseUsers();
  const match = users.find((user) => user.token === token);
  return match ? { name: match.name } : null;
}
