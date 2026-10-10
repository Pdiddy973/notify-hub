// Explains why a value cannot be a bot token, or returns null when its shape is right.
// Discord bot tokens are three base64url parts separated by dots.
export function botTokenProblem(value: string): string | null {
  if (/^\d{17,20}$/.test(value)) {
    return 'That is an ID (probably the Application ID), not the bot token.';
  }
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return 'That is the Public Key, not the bot token.';
  }
  if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(value)) {
    return 'A bot token has three parts separated by dots.';
  }
  return null;
}
