/** Service-level failure with an HTTP-style status so a future API layer (P5) can map it without guessing. */
export class StudyRunError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409,
    public readonly details: string[] = []
  ) {
    super(code);
    this.name = 'StudyRunError';
  }
}
