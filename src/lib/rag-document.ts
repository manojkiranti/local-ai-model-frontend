/** Turn an uploaded file name into an editable document title. */
export function documentTitleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const basename = dot > 0 ? filename.slice(0, dot) : filename
  const readable = basename.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!readable) return filename
  return readable.charAt(0).toUpperCase() + readable.slice(1)
}
