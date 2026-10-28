# Security Review

## Implemented controls

- No participant login or direct identifiers.
- Anonymous random UUID session stored in HttpOnly, SameSite=Lax cookie.
- Admin password hashing uses Node.js `scrypt` with a random salt.
- Admin session payload is HMAC-SHA256 signed using `AUTH_SECRET`, HttpOnly, SameSite=Lax and Secure in production.
- Admin session expires after 8 hours.
- Server-side admin role checks protect write/export APIs.
- Zod validates request bodies and research configuration.
- MongoDB driver operations are parameterized objects; user input is not concatenated into database commands.
- Search regex input is escaped.
- Important pages and APIs do not expose stack traces or database internals.
- Security headers disable framing and unnecessary browser permissions.
- No secret is stored in source; `.env*` is gitignored and `.env.example` is blank.
- No Google Analytics, Hotjar, FullStory, social pixel or participant replay tooling.

## Operational requirements

Use a long random `AUTH_SECRET`, HTTPS, least-privilege Atlas credentials and restricted Atlas Network Access. Do not place production participant exports in the repository.
