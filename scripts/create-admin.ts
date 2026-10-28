import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { collections } from '../src/lib/db/collections';
import { hashPassword } from '../src/lib/security/password';
import { ensureIndexes } from '../src/lib/db/indexes';
import type { AdminRole } from '../src/types/research';
import { getMongoClient } from '../src/lib/db/mongodb';
import { loadDevelopmentEnv } from './load-env';

async function hiddenPrompt(label: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('create-admin requires an interactive terminal.');
  }
  output.write(label);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          output.write('\n');
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length) value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
    };
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  loadDevelopmentEnv();
  const rl = createInterface({ input, output });

  try {
    const username = (await rl.question('Username: ')).trim();
    const roleInput = (await rl.question('Role [RESEARCHER/SUPERVISOR] (default RESEARCHER): ')).trim().toUpperCase();
    const role: AdminRole = roleInput === 'SUPERVISOR' ? 'SUPERVISOR' : 'RESEARCHER';
    rl.close();

    const password = await hiddenPrompt('Password (min 12 characters): ');
    const confirm = await hiddenPrompt('Confirm password: ');

    if (!username) throw new Error('Username is required.');
    if (password !== confirm) throw new Error('Passwords do not match.');

    const passwordHash = await hashPassword(password);
    await ensureIndexes();
    const { admins } = await collections();
    await admins.insertOne({ username, passwordHash, role, createdAt: new Date() });
    console.log(`Admin created: ${username} (${role}). Password was not logged.`);
  } finally {
    rl.close();
    const client = await getMongoClient().catch(() => null);
    await client?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
