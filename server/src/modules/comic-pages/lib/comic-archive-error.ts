export class ComicArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComicArchiveError';
  }
}
