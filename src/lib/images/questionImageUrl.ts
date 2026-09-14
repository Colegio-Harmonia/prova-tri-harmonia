/**
 * Same-origin, authenticated URL for an image attached to a question.
 *
 * The Drive thumbnail URL is retained in the payload for document creation,
 * but must not be used by the review UI: Google can reject its redirect when
 * the teacher is signed in to a different Workspace account.
 */
export function questionImageUrl(examId: number, driveFileId: string): string {
  return `/api/exams/${encodeURIComponent(String(examId))}/images/${encodeURIComponent(driveFileId)}`
}
