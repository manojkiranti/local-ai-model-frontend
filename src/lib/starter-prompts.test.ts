import { describe, expect, it } from 'vitest'

import { startersFor } from '@/lib/starter-prompts'

const prompts = (scope: string | null | undefined, name?: string) =>
  startersFor(scope, name).cards.map((card) => card.prompt)
const categories = (scope: string | null | undefined, name?: string) =>
  startersFor(scope, name).cards.map((card) => card.category)

describe('startersFor', () => {
  // Each of these was checked on 2026-09-28 against the real NRB corpus and
  // finds its document in the top 2 results; the last one uses the live forex
  // tool. Rewording one un-tests it, so they are pinned exactly.
  it('offers the tested NRB questions in the NRB tab', () => {
    expect(prompts('nrb', 'Nepal Rastra Bank')).toEqual([
      "What is NRB's interest rate corridor and how does it work?",
      "What are the KYC and customer due diligence requirements under NRB's AML/CFT rules?",
      'What changed in the Payment Systems Unified Directive 2082?',
      "What does NRB's Digital Lending guideline say?",
      "What is today's NRB exchange rate for USD?",
    ])
  })

  it('tells an NRB user what the tab searches and to check machine-recovered pages', () => {
    expect(startersFor('nrb', 'Nepal Rastra Bank').subtitle).toBe(
      'Ask about NRB directives, circulars, Acts and bylaws. Answers cite the source document; check any page marked machine-recovered.',
    )
  })

  // HRMS is not connected on this deployment, so an employee card fails on click.
  it('offers General nothing that needs employee data', () => {
    expect(categories(null)).toEqual(['Web research', 'Create a file', 'Explore tools'])
    for (const prompt of prompts(null)) expect(prompt.toLowerCase()).not.toContain('employee')
  })

  it('gives General a self-contained file prompt', () => {
    const file = startersFor(null).cards.find((card) => card.category === 'Create a file')
    expect(file?.prompt).toMatch(/Q1 120, Q2 150, Q3 170, Q4 210/)
  })

  it('describes General as drafting, calculating and research, not documents', () => {
    expect(startersFor(null).subtitle).toBe(
      'Draft, calculate, research the web, or turn an answer into a spreadsheet, document or chart.',
    )
  })

  // A department without its own set must not fall back to General's cards:
  // those are exactly the off-topic starters this module exists to remove.
  it('offers another department one card about its own documents', () => {
    const { cards, subtitle } = startersFor('hrdept', 'Human Resources')

    expect(cards.map((card) => card.text)).toEqual(['Ask about Human Resources documents'])
    expect(cards[0].prompt).toContain('Human Resources')
    expect(subtitle).toContain('Human Resources')
    expect(categories('hrdept', 'Human Resources')).not.toContain('Web research')
  })

  it('names a department by its code when its name is not known', () => {
    expect(startersFor('it').cards[0].text).toBe('Ask about it documents')
  })

  // Departments still loading: showing General's cards would flash starters for
  // a tab the user is about to leave.
  it('offers no cards while the scope is unknown', () => {
    expect(startersFor(undefined).cards).toEqual([])
  })
})
