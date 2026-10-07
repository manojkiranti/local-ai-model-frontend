const SAFE_HREF = /^(https?:|mailto:|#)/i

/**
 * A crafted .docx can carry any hyperlink target, `javascript:` included, and
 * the renderer copies it into an <a href>. Keep web, mail and in-document
 * links (opened in a new tab); strip everything else to plain text.
 */
export function neutralizeLinks(root: HTMLElement) {
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    if (!SAFE_HREF.test(href.trim())) {
      a.removeAttribute('href')
    } else if (!href.startsWith('#')) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
  })
}
