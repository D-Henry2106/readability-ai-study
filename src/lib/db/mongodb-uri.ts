/** Require an explicit database in the connection URI; do not silently use MongoDB's 'test' default. */
export function databaseNameFromMongoUri(uri: string): string {
  // Locate the path after the authority. This also supports comma-separated mongodb:// hosts.
  const match = /^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^?#]+)/i.exec(uri);
  if (!match) {
    throw new Error('MONGODB_URI must include a database name after the host (/<database>).');
  }

  let name: string;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    throw new Error('MONGODB_URI contains an invalid database path.');
  }

  if (!name || /[\/\\."$*<>:|?\0]/.test(name)) {
    throw new Error('MONGODB_URI contains an invalid database name.');
  }

  return name;
}
