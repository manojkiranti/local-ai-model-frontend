import {
  ArrowLeftRight,
  CreditCard,
  FileSpreadsheet,
  Globe2,
  Library,
  Percent,
  ShieldCheck,
  Smartphone,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/** One clickable card on an empty chat. `prompt` is what is sent, verbatim. */
export interface StarterCard {
  category: string
  text: string
  prompt: string
  icon: LucideIcon
}

export interface Starters {
  /** Empty while the scope is unknown. */
  subtitle: string
  cards: StarterCard[]
}

const CITE_NOTE = 'Answers cite the source document; check any page marked machine-recovered.'

/**
 * Checked on 2026-09-28 against the real NRB corpus: each finds its document in
 * the top 2 results, and the exchange-rate one uses the live NRB forex tool.
 * Rewording a prompt un-tests it — re-run the check before changing one.
 */
const NRB: Starters = {
  subtitle: `Ask about NRB directives, circulars, Acts and bylaws. ${CITE_NOTE}`,
  cards: [
    {
      category: 'Interest rates',
      text: "What is NRB's interest rate corridor?",
      prompt: "What is NRB's interest rate corridor and how does it work?",
      icon: Percent,
    },
    {
      category: 'KYC & AML',
      text: 'KYC and customer due diligence under the AML/CFT rules.',
      prompt:
        "What are the KYC and customer due diligence requirements under NRB's AML/CFT rules?",
      icon: ShieldCheck,
    },
    {
      category: 'Payment systems',
      text: 'What changed in the Payment Systems Unified Directive 2082?',
      prompt: 'What changed in the Payment Systems Unified Directive 2082?',
      icon: CreditCard,
    },
    {
      category: 'Digital lending',
      text: "What does NRB's Digital Lending guideline say?",
      prompt: "What does NRB's Digital Lending guideline say?",
      icon: Smartphone,
    },
    {
      category: 'Exchange rates',
      text: "Today's NRB exchange rate for USD.",
      prompt: "What is today's NRB exchange rate for USD?",
      icon: ArrowLeftRight,
    },
  ],
}

/**
 * General searches no documents, and HRMS is not connected on this deployment,
 * so every card here works without either: the web, a self-contained file, and
 * the tool list.
 */
const GENERAL: Starters = {
  subtitle:
    'Draft, calculate, research the web, or turn an answer into a spreadsheet, document or chart.',
  cards: [
    {
      category: 'Web research',
      text: 'Look up NIC Asia Bank and summarise what it offers.',
      prompt: 'Look up https://www.nicasiabank.com/ and summarise what NIC Asia Bank offers.',
      icon: Globe2,
    },
    {
      category: 'Create a file',
      text: 'Turn quarterly figures into an Excel sheet with a total row.',
      prompt:
        'Create an Excel sheet from these figures, with a total row: Q1 120, Q2 150, Q3 170, Q4 210.',
      icon: FileSpreadsheet,
    },
    {
      category: 'Explore tools',
      text: 'Show me what tools are available in this workspace.',
      prompt: 'Show me what tools are available in this workspace.',
      icon: Wrench,
    },
  ],
}

/** A department with no tested set of its own: one card about its documents. */
function departmentStarters(name: string): Starters {
  return {
    subtitle: `Ask about ${name} documents. ${CITE_NOTE}`,
    cards: [
      {
        category: 'Department documents',
        text: `Ask about ${name} documents`,
        prompt: `What are the main topics covered in the ${name} documents? Summarise them and cite the source documents.`,
        icon: Library,
      },
    ],
  }
}

/**
 * The empty-chat starters for a scope: a department code, `null` for General,
 * or `undefined` while the scope is not known (no cards — never General's, which
 * would flash starters for a tab the user is about to leave).
 *
 * A department never falls back to General's cards: off-topic starters in a
 * department tab are what this replaces.
 */
export function startersFor(scope: string | null | undefined, departmentName?: string): Starters {
  if (scope === undefined) return { subtitle: '', cards: [] }
  if (scope === null) return GENERAL
  if (scope === 'nrb') return NRB
  return departmentStarters(departmentName ?? scope)
}
