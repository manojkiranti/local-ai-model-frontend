import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { fetchMemoLogo, type MemoBlock, type MemoPreview } from '@/lib/api'

/** The approval-grid heading — fixed by the memo format, like the gateway's
 * `APPROVAL_HEADING`. */
const APPROVAL_HEADING = 'Submitted for review/ support/ approval as proposed'

/** `**text**` spans in bold, everything else as plain text (never HTML). */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/)
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>))}
    </>
  )
}

/** '5th August, 2025' with the ordinal suffix raised, as in the .docx. */
function MemoDate({ date }: { date: string }) {
  const m = /^(\d{1,2})(st|nd|rd|th)\b([\s\S]*)$/.exec(date)
  if (!m) return <>{date}</>
  return (
    <>
      {m[1]}
      <sup>{m[2]}</sup>
      {m[3]}
    </>
  )
}

/** The memo logo, fetched once per app session (it is the same image for
 * every memo) as an authed blob URL. Module-level for the same reason as the
 * deck preview's branding art. */
let logoPromise: Promise<string | null> | null = null
function loadMemoLogo(): Promise<string | null> {
  if (!logoPromise) {
    logoPromise = fetchMemoLogo()
      .then((res) => res.blob())
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => null)
  }
  return logoPromise
}

function useMemoLogo(): string | null {
  const [logo, setLogo] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadMemoLogo().then((url) => {
      if (!cancelled) setLogo(url)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return logo
}

function SectionBody({ content }: { content: MemoBlock[] }) {
  let number = 0
  const out: ReactNode[] = []
  content.forEach((block, i) => {
    if (typeof block === 'string') {
      out.push(
        <p key={i} className="mb-1.5 text-justify">
          <Rich text={block} />
        </p>,
      )
    } else if ('table' in block) {
      const { headers = [], rows } = block.table
      const ncols = Math.max(headers.length, ...rows.map((r) => r.length), 1)
      const pad = (cells: string[]) => Array.from({ length: ncols }, (_, c) => cells[c] ?? '')
      out.push(
        <table key={i} className="mb-2 w-full border-collapse text-[10px]">
          {headers.length > 0 && (
            <thead>
              <tr>
                {pad(headers).map((h, c) => (
                  <th key={c} className="border border-black px-1 py-0.5 text-left font-bold">
                    <Rich text={h} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {pad(row).map((cell, c) => (
                  <td key={c} className="border border-black px-1 py-0.5">
                    <Rich text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
    } else if ('heading' in block) {
      number += 1
      out.push(
        <p key={i} className="mt-0.5 font-bold">
          {number}. <Rich text={block.heading} />
        </p>,
      )
    } else {
      out.push(
        <ul key={i} className="mb-1.5 list-disc pl-[2.4em] text-justify">
          {block.bullets.map((item, j) =>
            typeof item === 'string' ? (
              <li key={j}>
                <Rich text={item} />
              </li>
            ) : (
              <li key={j}>
                <Rich text={item.text} />
                {item.bullets && item.bullets.length > 0 && (
                  <ul className="list-[circle] pl-[1.5em]">
                    {item.bullets.map((sub, k) => (
                      <li key={k}>
                        <Rich text={sub} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ),
          )}
        </ul>,
      )
    }
  })
  return <>{out}</>
}

/**
 * A generated memo drawn from create_memo's own validated content — the same
 * fixed format as the .docx: logo and MEMO, the ruled To/From/Subject/Date
 * block, lettered underlined sections, and the three-column signature grid.
 * Set in Arial on a white page in both themes, because it is a picture of a
 * printed document, not app chrome.
 */
export function MemoPages({ memo }: { memo: MemoPreview }) {
  const logo = useMemoLogo()
  const groups: (MemoPreview['signatories'][number] | null)[][] = []
  for (let i = 0; i < memo.signatories.length; i += 3) {
    const group: (MemoPreview['signatories'][number] | null)[] = memo.signatories.slice(i, i + 3)
    while (group.length < 3) group.push(null)
    groups.push(group)
  }
  const meta: [string, ReactNode][] = [
    ['To', memo.to],
    ['From', memo.from],
    ['Subject', memo.subject],
    ['Date', <MemoDate key="d" date={memo.date} />],
  ]

  return (
    <article
      data-testid="memo-page"
      className="mx-auto w-full rounded-md bg-white px-[8%] py-[7%] font-[Arial,sans-serif] text-[11px] leading-snug text-black shadow-sm"
    >
      <header className="flex items-end justify-between">
        <h2 className="text-[20px] font-bold leading-none">MEMO</h2>
        {logo ? (
          <img src={logo} alt="NIC ASIA" className="h-auto w-[18%] min-w-14" />
        ) : (
          <span className="font-bold text-[#e60012]">NIC ASIA</span>
        )}
      </header>

      <table className="mt-2 w-full border-y-2 border-black">
        <tbody>
          {meta.map(([label, value]) => (
            <tr key={label} className="align-top">
              <th scope="row" className="w-[13%] py-0.5 text-left font-bold">
                {label}
              </th>
              <td className="w-[3%] py-0.5 font-bold">:</td>
              <td className={label === 'Subject' ? 'py-0.5 text-[12px]' : 'py-0.5'}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {memo.sections.map((section, i) => (
        <section key={i} className="mt-3.5">
          <h3 className="mb-0.5 text-[12px] font-bold">
            {String.fromCharCode(65 + i)}. {section.heading}
          </h3>
          <SectionBody content={section.content} />
        </section>
      ))}

      <h3 className="mt-5 mb-1 font-bold underline">{APPROVAL_HEADING}</h3>
      <table className="w-full table-fixed border-collapse text-[10px] font-bold">
        <tbody>
          {groups.map((group, g) => (
            <Fragment key={g}>
              <tr>
                {group.map((sig, i) => (
                  <td key={i} className="border border-black px-1 text-center">
                    {sig?.role}
                  </td>
                ))}
              </tr>
              <tr>
                {group.map((_, i) => (
                  <td key={i} aria-hidden className="h-12 border border-black" />
                ))}
              </tr>
              <tr>
                {group.map((sig, i) => (
                  <td key={i} className="border border-black px-1 text-center align-top">
                    {sig && (
                      <>
                        <div>{sig.name}</div>
                        {sig.designation && <div>{sig.designation}</div>}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </article>
  )
}
