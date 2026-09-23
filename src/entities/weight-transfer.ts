export type TransferDelimiter = 'comma' | 'semicolon' | 'tab'
export type DuplicatePolicy = 'skip' | 'replace'
export interface ImportInput { content: string; delimiter: TransferDelimiter; duplicate_policy: DuplicatePolicy }
export interface ImportPreview {
  rows: { row: number; date: string | null; weight_kg: number | null; action: 'import' | 'replace' | 'skip' | 'error'; errors: string[] }[]
  imported: number
  replaced: number
  skipped: number
  errors: number
  preview_token: string
}
export interface ImportResult { imported: number; replaced: number; skipped: number }
