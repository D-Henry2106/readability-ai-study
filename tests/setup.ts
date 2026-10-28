if (!process.env.AUTH_SECRET) {
  Object.assign(process.env, { AUTH_SECRET: 'test-only-auth-secret-change-me-1234567890' });
}

