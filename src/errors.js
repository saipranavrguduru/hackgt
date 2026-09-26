export function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status });
}
export function requireValue(condition, code, message, status = 400) {
  if (!condition) fail(code, message, status);
}
