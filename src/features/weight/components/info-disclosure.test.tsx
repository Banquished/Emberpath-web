import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoDisclosure } from './info-disclosure'

function Example() {
  return <InfoDisclosure label="About this chart"><p>Gray lines connect measurements.</p></InfoDisclosure>
}

describe('info disclosure', () => {
  it('starts collapsed and ties the toggle to its panel', () => {
    render(<Example />)
    const toggle = screen.getByRole('button', { name: 'About this chart' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Gray lines connect measurements.')).not.toBeVisible()
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(screen.getByText('Gray lines connect measurements.'))
  })

  it('opens and closes with a tap or click', async () => {
    const user = userEvent.setup()
    render(<Example />)
    const toggle = screen.getByRole('button', { name: 'About this chart' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Gray lines connect measurements.')).toBeVisible()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Gray lines connect measurements.')).not.toBeVisible()
  })

  it.each(['{Enter}', ' '])('toggles from the keyboard with %j and keeps focus on the toggle', async (key) => {
    const user = userEvent.setup()
    render(<Example />)
    await user.tab()
    const toggle = screen.getByRole('button', { name: 'About this chart' })
    expect(toggle).toHaveFocus()
    await user.keyboard(key)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Gray lines connect measurements.')).toBeVisible()
    expect(toggle).toHaveFocus()
    await user.keyboard(key)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not depend on hover', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.hover(screen.getByRole('button', { name: 'About this chart' }))
    expect(screen.getByText('Gray lines connect measurements.')).not.toBeVisible()
  })
})
