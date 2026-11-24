export function isAppAccessDenied(error: unknown): boolean {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message : "";
  // Match the app-opening failure, not unrelated object/export permission errors
  // or network/login failures. Qlik embeds emit this via qlik-embed:error.
  return /no permission to open (?:the )?app\b/i.test(message)
    || /access denied(?:[^.\n]*)(?:open|application|app\b)/i.test(message);
}
