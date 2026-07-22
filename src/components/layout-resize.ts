export const DEFAULT_SIDEBAR_WIDTH = 176
export const DEFAULT_UPLOAD_PANE_HEIGHT = 300
export const DEFAULT_LIBRARY_FOLDER_WIDTH = 210
export const DEFAULT_LIBRARY_INSPECTOR_WIDTH = 245

export function clampLayoutValue(kind: 'sidebar' | 'upload' | 'library-folder' | 'library-inspector', value: number, available: number): number {
  const rounded = Math.round(value)
  if (kind === 'sidebar') return Math.min(280, Math.max(150, rounded))
  if (kind === 'upload') return Math.min(Math.max(210, available - 290), Math.max(180, rounded))
  if (kind === 'library-folder') return Math.min(Math.max(180, available - 720), Math.max(170, rounded))
  return Math.min(Math.max(220, available - 760), Math.max(210, rounded))
}
