/**
 * `docx-preview` renders a hanging indent (Word's left indent L with the first
 * line pulled back by H) as `margin-inline-start: L; text-indent: -H`. The
 * paragraph box then starts at L, so its border (a memo's To/From rule) begins
 * an inch in, and the library's tab-stop pass, which measures from the box
 * plus its margin, lands every tab in the wrong place. Re-express it as
 * margin L - H plus padding H: the text sits exactly where it was, but the box
 * and its border start where the first line does, as in Word.
 */
export function normalizeHangingIndents(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('p').forEach((p) => {
    const style = getComputedStyle(p)
    const indent = parseFloat(style.textIndent)
    if (!(indent < 0)) return
    const margin = parseFloat(style.marginLeft) || 0
    const padding = parseFloat(style.paddingLeft) || 0
    p.style.marginInlineStart = ''
    p.style.marginLeft = `${margin + indent}px`
    p.style.paddingLeft = `${padding - indent}px`
  })
}
