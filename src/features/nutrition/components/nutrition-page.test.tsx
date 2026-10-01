import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewOptions, PreviewRequest, PreviewResponse } from '@/entities/nutrition-preview'
import { NutritionPage } from './nutrition-page'

const auth = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  userId: 'user-a',
  sessionId: 'session-a',
  getToken: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('@clerk/react', () => ({ useAuth: () => auth }))
vi.mock('./nutrition-plans', () => ({ NutritionActivePlan: () => null, NutritionHistory: () => null }))
vi.mock('../api/nutrition-plans', () => ({
  useActiveNutritionPlan: () => ({ isSuccess: true, isFetching: false, data: { revision: 0, plan: null } }),
  useNutritionPlanHistory: () => ({ isSuccess: true, isFetching: false, data: { pages: [{ revision: 0, plans: [], next_before_version: null }] } }),
}))

const suggestions: PreviewOptions['starting_suggestions'] = {
  protein_g_per_kg: {
    value: 1.6,
    unit: 'g/kg/day',
    scope: 'Training-focused editable starting point, not a universal minimum or safe target.',
    sources: [
      { id: 'doi:10.1186/s12970-017-0177-8', url: 'https://pubmed.ncbi.nlm.nih.gov/28642676/', scope: 'ISSN (2017): 1.4-2.0 g/kg/day sufficient for most exercising adults.' },
      { id: 'doi:10.1136/bjsports-2017-097608', url: 'https://pubmed.ncbi.nlm.nih.gov/28698222/', scope: 'Resistance-training meta-analysis: group-level plateau near 1.6 g/kg/day.' },
    ],
  },
  fat_share: {
    value: 0.3,
    unit: 'fraction_of_daily_kcal',
    scope: '30% is a product allocation choice, not an individual fat requirement.',
    sources: [{ id: 'who_fat_carbohydrate_2023', url: 'https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates', scope: 'WHO general-adult fat guidance discusses a 30% limit and fat quality.' }],
  },
  fibre_g_per_day: {
    value: 25,
    unit: 'g/day',
    scope: 'Editable starting value; food sources and actual intake are not assessed.',
    sources: [{ id: 'who_fat_carbohydrate_2023', url: 'https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates', scope: 'WHO general-adult guidance concerns naturally occurring dietary fibre.' }],
  },
}

const options: PreviewOptions = {
  methods: [
    { id: 'mifflin_st_jeor_1990_original', source_id: 'doi:10.1093/ajcn/51.2.241', source_url: 'https://doi.org/10.1093/ajcn/51.2.241', scope: 'Original 1990 resting-energy equation, not maintenance; study ages 19-78.' },
    { id: 'nasem_2023_adult_tee', source_id: 'doi:10.17226/26818#table-s-3', source_url: 'https://www.nationalacademies.org/read/26818/chapter/2', scope: '2023 adult (19+) EER/TEE by general activity; weight-stable maintenance estimate.' },
    { id: 'manual_target_v1', source_id: null, source_url: null, scope: 'User-entered target when calculated methods are unsuitable; no expenditure estimate.' },
  ],
  formula_parameters: ['male', 'female'],
  activity_categories: [
    { id: 'inactive', pal_min_inclusive: 1, pal_max_exclusive: 1.53 },
    { id: 'low_active', pal_min_inclusive: 1.53, pal_max_exclusive: 1.68 },
    { id: 'active', pal_min_inclusive: 1.68, pal_max_exclusive: 1.85 },
    { id: 'very_active', pal_min_inclusive: 1.85, pal_max_exclusive: 2.5 },
  ],
  activity_source_url: 'https://www.nationalacademies.org/read/26818/chapter/7',
  starting_suggestions: suggestions,
  notice: 'Estimates and targets are provisional, not measurements or medical advice. Mathematical feasibility does not establish individual safety, clinical suitability or strength-sport needs.',
}

const calculatedRequest: PreviewRequest = {
  method: 'nasem_2023_adult_tee',
  age_years: 30,
  weight_kg: 80,
  height_cm: 180,
  formula: 'male',
  activity: 'active',
  calorie_adjustment_kcal: -150,
  strategy: { protein: { mode: 'per_kg', g_per_kg: 2 }, fat_share: 0.3, fibre_g_per_day: 25 },
}
const manualRequest: PreviewRequest = {
  method: 'manual_target_v1',
  age_years: 19,
  weight_kg: 80,
  manual_base_target_kcal: 2400,
  calorie_adjustment_kcal: 0,
  strategy: { protein: { mode: 'daily_grams', g_per_day: 140 }, fat_share: 0.3, fibre_g_per_day: 25 },
}
const calculatedResult: PreviewResponse = {
  method: 'nasem_2023_adult_tee',
  inputs: calculatedRequest,
  resting_estimate: { method: 'mifflin_st_jeor_1990_original', source_id: 'doi:10.1093/ajcn/51.2.241', source_url: 'https://doi.org/10.1093/ajcn/51.2.241', kcal_per_day: 1782 },
  maintenance_estimate: { method: 'nasem_2023_adult_tee', source_id: 'doi:10.17226/26818#table-s-3', source_url: 'https://www.nationalacademies.org/read/26818/chapter/2', kcal_per_day: 3126 },
  base_target_kcal: 3126,
  calorie_adjustment_kcal: -150,
  daily_target: { kcal: 2976, protein_g: 160, fat_g: 99.2, carbohydrate_g: 360.8, fibre_g: 25 },
  macro_method: 'macro_allocation_4_9_4_v1',
  starting_suggestions: suggestions,
  notice: options.notice,
}
const manualResult: PreviewResponse = {
  method: 'manual_target_v1',
  inputs: manualRequest,
  resting_estimate: null,
  maintenance_estimate: null,
  base_target_kcal: 2400,
  calorie_adjustment_kcal: 0,
  daily_target: { kcal: 2400, protein_g: 140, fat_g: 80, carbohydrate_g: 280, fibre_g: 25 },
  macro_method: 'macro_allocation_4_9_4_v1',
  starting_suggestions: suggestions,
  notice: options.notice,
}

function failure(status: number, detail: string, requestId: string) {
  return Response.json({ detail, request_id: requestId }, { status, headers: { 'X-Request-ID': requestId } })
}

function mockService(onPreview: (input: PreviewRequest, attempt: number) => Response | Promise<Response> = (input) => Response.json(input.method === 'manual_target_v1' ? manualResult : calculatedResult)) {
  let attempt = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/nutrition/v1/estimates/options') return Response.json(options)
    if (url === '/api/nutrition/v1/estimates/preview' && init?.method === 'POST') {
      attempt += 1
      return onPreview(JSON.parse(init.body as string) as PreviewRequest, attempt)
    }
    throw new Error(`Unexpected nutrition endpoint: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(<QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>)
}

function submittedRequests(fetchMock: ReturnType<typeof mockService>): PreviewRequest[] {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string) as PreviewRequest)
}

async function fillCalculated(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('form', { name: 'Nutrition preview' })
  await user.click(screen.getByRole('radio', { name: 'Calculate adult energy estimates' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '30')
  await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
  await user.type(screen.getByRole('spinbutton', { name: 'Height (cm)' }), '180')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Formula parameter' }), 'male')
  await user.selectOptions(screen.getByRole('combobox', { name: 'General activity category' }), 'active')
  await user.clear(screen.getByRole('spinbutton', { name: 'Chosen calorie adjustment (kcal/day)' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Chosen calorie adjustment (kcal/day)' }), '-150')
  await user.clear(screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' }), '2')
}

async function fillManual(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('form', { name: 'Nutrition preview' })
  await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '19')
  await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
  await user.type(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }), '2400')
  await user.click(screen.getByRole('radio', { name: 'Fixed daily grams' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Protein (g/day)' }), '140')
}

beforeEach(() => {
  Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a' })
  auth.getToken.mockReset().mockResolvedValue('test-token')
})

describe('authenticated nutrition preview', () => {
  it('opens and closes source scope with a named, focusable disclosure rather than hover', async () => {
    mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('form', { name: 'Nutrition preview' })
    const summary = screen.getByText('Source and scope for protein')
    const disclosure = summary.closest('details')
    expect(disclosure).not.toHaveAttribute('open')
    summary.focus()
    expect(summary).toHaveFocus()
    await user.click(summary)
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'doi:10.1186/s12970-017-0177-8' })).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/28642676/')
    await user.click(summary)
    expect(disclosure).not.toHaveAttribute('open')
  })

  it('loads source-labeled options and renders separate calculated estimates and chosen targets without saving', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading nutrition methods')
    await fillCalculated(user)
    expect(screen.getByRole('spinbutton', { name: 'Fat share (% of daily calories)' })).toHaveValue(30)
    expect(screen.getByRole('spinbutton', { name: 'Fibre (g/day)' })).toHaveValue(25)
    await user.click(screen.getByText('Source and scope for protein'))
    await user.click(screen.getByText('Source and scope for fat'))
    await user.click(screen.getByText('Source and scope for fibre'))
    await user.click(screen.getByText('Activity category PAL ranges and source'))
    expect(screen.getByRole('link', { name: 'doi:10.1186/s12970-017-0177-8' })).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/28642676/')
    expect(screen.getByText(/group-level plateau near 1.6 g\/kg\/day/)).toBeInTheDocument()
    expect(screen.getByText(/30% is a product allocation choice/)).toBeInTheDocument()
    expect(screen.getByText(/food sources and actual intake are not assessed/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Active' })).toBeInTheDocument()
    expect(screen.getByText('Active: PAL 1.68 to <1.85')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Mifflin-St Jeor/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    const result = within(await screen.findByRole('region', { name: 'Provisional daily target preview' }))
    expect(result.getByText('Provisional resting estimate').parentElement).toHaveTextContent('1,782 kcal/day')
    expect(result.getByText('Estimated maintenance').parentElement).toHaveTextContent('3,126 kcal/day')
    expect(result.getByText('Base target from estimated maintenance').parentElement).toHaveTextContent('3,126 kcal/day')
    expect(result.getByText('Your chosen calorie adjustment').parentElement).toHaveTextContent('-150 kcal/day')
    expect(result.getByText('Chosen daily calorie target').parentElement).toHaveTextContent('2,976 kcal/day')
    expect(result.getByText('Protein').parentElement).toHaveTextContent('160 g/day')
    expect(result.getByText('Carbohydrate').parentElement).toHaveTextContent('360.8 g/day')
    await user.click(result.getByText('Method, normalized inputs and sources'))
    expect(result.getByRole('link', { name: /Mifflin-St Jeor/ })).toHaveAttribute('href', 'https://doi.org/10.1093/ajcn/51.2.241')
    expect(result.getByRole('link', { name: /2023 adult TEE/ })).toHaveAttribute('href', 'https://www.nationalacademies.org/read/26818/chapter/2')
    expect(result.getByText(/age 30 years, manually entered weight 80 kg, height 180 cm, male formula, active activity/)).toBeInTheDocument()
    expect(result.getByText(/This calculation has not been saved as a plan/)).toBeInTheDocument()
    expect(result.getByText(/An existing saved plan stays unchanged/)).toBeInTheDocument()
    expect(submittedRequests(fetchMock)).toEqual([calculatedRequest])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/nutrition/v1/estimates/options', '/api/nutrition/v1/estimates/preview'])
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('previews an explicitly entered manual base and fixed protein without suggesting an expenditure estimate', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    await user.click(screen.getByText('About Enter a manual base target (scope and source)'))
    expect(screen.getByText(/User-entered target when calculated methods are unsuitable/)).toBeInTheDocument()
    expect(screen.getByText(/not applied in fixed mode/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Formula parameter' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    const result = within(await screen.findByRole('region', { name: 'Provisional daily target preview' }))
    expect(result.getByText('Provisional resting estimate').parentElement).toHaveTextContent('Not calculated for a manual target')
    expect(result.getByText('Estimated maintenance').parentElement).toHaveTextContent('Not calculated for a manual target')
    expect(result.getByText('Manually chosen base target (not an estimate)').parentElement).toHaveTextContent('2,400 kcal/day')
    expect(result.getByText('Chosen daily calorie target').parentElement).toHaveTextContent('2,400 kcal/day')
    expect(result.getByText('Protein').parentElement).toHaveTextContent('140 g/day')
    expect(result.getByText('Carbohydrate').parentElement).toHaveTextContent('280 g/day')
    expect(submittedRequests(fetchMock)).toEqual([manualRequest])
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  it('submits edited fat and fibre suggestions by keyboard with the chosen values in the request', async () => {
    const editedRequest: PreviewRequest = { ...manualRequest, strategy: { ...manualRequest.strategy, fat_share: 0.25, fibre_g_per_day: 30 } }
    const editedResult: PreviewResponse = {
      ...manualResult,
      inputs: editedRequest,
      daily_target: { kcal: 2400, protein_g: 140, fat_g: 66.67, carbohydrate_g: 309.99, fibre_g: 30 },
    }
    const fetchMock = mockService(() => Response.json(editedResult))
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    const fat = screen.getByRole('spinbutton', { name: 'Fat share (% of daily calories)' })
    await user.clear(fat)
    await user.type(fat, '25')
    const fibre = screen.getByRole('spinbutton', { name: 'Fibre (g/day)' })
    await user.clear(fibre)
    await user.type(fibre, '30')
    await user.keyboard('{Enter}')
    const result = within(await screen.findByRole('region', { name: 'Provisional daily target preview' }))
    expect(result.getByText('Fat').parentElement).toHaveTextContent('66.67 g/day')
    expect(result.getByText('Fibre').parentElement).toHaveTextContent('30 g/day')
    expect(submittedRequests(fetchMock)).toEqual([editedRequest])
  })

  it('rejects an age under 19 with an accessible field error before calling the preview API', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    const age = screen.getByRole('spinbutton', { name: 'Age (completed years)' })
    await user.clear(age)
    await user.type(age, '18')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(screen.getByText('Age under 19 is not supported by this calculator.')).toBeInTheDocument()
    expect(age).toHaveAttribute('aria-invalid', 'true')
    expect(age).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Check the indicated inputs')
    expect(submittedRequests(fetchMock)).toHaveLength(0)
  })

  it('removes errors for fields hidden after changing the method or protein mode', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('form', { name: 'Nutrition preview' })
    await user.click(screen.getByRole('radio', { name: 'Calculate adult energy estimates' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '30')
    await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
    await user.clear(screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' }), '0')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(screen.getByText('Choose a formula parameter.')).toBeInTheDocument()
    expect(screen.getByText('Protein in g/kg/day must be between 0.01 and 5.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
    expect(screen.queryByText('Choose a formula parameter.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Fixed daily grams' }))
    expect(screen.queryByText('Protein in g/kg/day must be between 0.01 and 5.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(submittedRequests(fetchMock)).toHaveLength(0)
  })

  it('shows a 422 infeasible-macros response and lets the user edit and retry without changing another input', async () => {
    const fetchMock = mockService((_input, attempt) => attempt === 1
      ? failure(422, 'Target cannot accommodate chosen protein, fat and fibre', 'req-422')
      : Response.json(manualResult))
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    const protein = screen.getByRole('spinbutton', { name: 'Protein (g/day)' })
    await user.clear(protein)
    await user.type(protein, '2000')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('heading', { name: 'Check your inputs' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Target cannot accommodate chosen protein, fat and fibre')
    expect(screen.getByText('Request ID: req-422')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Provisional daily target preview' })).not.toBeInTheDocument()
    await user.clear(protein)
    await user.type(protein, '140')
    expect(screen.queryByText('Request ID: req-422')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('region', { name: 'Provisional daily target preview' })).toBeInTheDocument()
    expect(submittedRequests(fetchMock)).toEqual([{ ...manualRequest, strategy: { ...manualRequest.strategy, protein: { mode: 'daily_grams', g_per_day: 2000 } } }, manualRequest])
  })

  it('fails closed without a token, then retries the protected options request after a token becomes available', async () => {
    auth.getToken.mockResolvedValueOnce(null)
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Session verification failed' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Sign out and sign in again')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('form', { name: 'Nutrition preview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('form', { name: 'Nutrition preview' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows invalid-session 401 and generic forbidden 403 distinctly, without presenting an editable calculator', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(401, 'Missing or invalid Clerk session', 'req-401')).mockResolvedValueOnce(failure(403, 'Forbidden', 'req-403'))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    renderPage(client)
    expect(await screen.findByRole('heading', { name: 'Session verification failed' })).toBeInTheDocument()
    expect(screen.getByText('Request ID: req-401')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Nutrition access denied' })).toBeInTheDocument()
    expect(screen.getByText('Request ID: req-403')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Nutrition preview' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    client.clear()
  })

  it('does not keep the calculator visible if the service forbids a preview', async () => {
    mockService(() => failure(403, 'Forbidden', 'req-preview-403'))
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('heading', { name: 'Nutrition access denied' })).toBeInTheDocument()
    expect(screen.getByText('Request ID: req-preview-403')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Nutrition preview' })).not.toBeInTheDocument()
  })

  it('shows an unavailable 503 without fake suggestions, then loads the real options on retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(503, 'Authentication unavailable', 'req-503')).mockResolvedValueOnce(Response.json(options))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    expect(screen.queryByRole('form', { name: 'Nutrition preview' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Editable starting suggestion/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('form', { name: 'Nutrition preview' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows an invalid successful options response as a retryable error rather than rendering an incomplete calculator', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ methods: [], starting_suggestions: {} })).mockResolvedValueOnce(Response.json(options))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid response')
    expect(screen.queryByRole('form', { name: 'Nutrition preview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('form', { name: 'Nutrition preview' })).toBeInTheDocument()
  })

  it('retries a failed POST with the same inputs and no plan-save call', async () => {
    const fetchMock = mockService((_input, attempt) => attempt === 1 ? failure(503, 'Authentication unavailable', 'req-post-503') : Response.json(manualResult))
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    expect(screen.getByText('Request ID: req-post-503')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(await screen.findByRole('region', { name: 'Provisional daily target preview' })).toBeInTheDocument()
    expect(submittedRequests(fetchMock)).toEqual([manualRequest, manualRequest])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/nutrition/v1/estimates/options', '/api/nutrition/v1/estimates/preview', '/api/nutrition/v1/estimates/preview'])
  })

  it('removes a completed preview on edit and ignores an in-flight result for superseded inputs', async () => {
    let resolvePending!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { resolvePending = resolve })
    const fetchMock = mockService((_input, attempt) => attempt === 1 ? Response.json(calculatedResult) : pending)
    const user = userEvent.setup()
    renderPage()
    await fillCalculated(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('region', { name: 'Provisional daily target preview' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to inputs' }))
    const weight = screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' })
    await user.clear(weight)
    await user.type(weight, '81')
    expect(screen.queryByRole('region', { name: 'Provisional daily target preview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await waitFor(() => expect(submittedRequests(fetchMock)).toHaveLength(2))
    expect(screen.getByRole('status')).toHaveTextContent('Calculating your provisional preview')
    await user.clear(weight)
    await user.type(weight, '82')
    await act(async () => { resolvePending(Response.json(calculatedResult)); await pending })
    expect(screen.queryByRole('region', { name: 'Provisional daily target preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('increments protein by exactly 0.1 with explicit keyboard-accessible controls without snapping manual precision', async () => {
    const fetchMock = mockService((input) => Response.json({ ...manualResult, inputs: input }))
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('form', { name: 'Nutrition preview' })
    const protein = screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' })
    expect(protein).toHaveAttribute('step', 'any')
    await user.click(screen.getByRole('button', { name: 'Increase protein by 0.1 g/kg/day' }))
    expect(protein).toHaveValue(1.7)
    await user.click(screen.getByRole('button', { name: 'Decrease protein by 0.1 g/kg/day' }))
    expect(protein).toHaveValue(1.6)
    await user.keyboard('{Enter}')
    expect(protein).toHaveValue(1.5)
    await user.clear(protein)
    await user.type(protein, '1.65')
    expect((protein as HTMLInputElement).validity.stepMismatch).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Increase protein by 0.1 g/kg/day' }))
    expect(protein).toHaveValue(1.75)
    await user.click(screen.getByRole('button', { name: 'Decrease protein by 0.1 g/kg/day' }))
    expect(protein).toHaveValue(1.65)
    await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '19')
    await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
    await user.type(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }), '2400')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('region', { name: 'Provisional daily target preview' })).toBeInTheDocument()
    expect(submittedRequests(fetchMock)[0]?.strategy.protein).toEqual({ mode: 'per_kg', g_per_kg: 1.65 })
  })

  it('steps protein by exactly 0.1 from the field itself with the up and down arrow keys', async () => {
    mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('form', { name: 'Nutrition preview' })
    const protein = screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' })
    expect(protein).toHaveAccessibleDescription(/up and down arrow keys/)
    await user.click(protein)
    await user.keyboard('{ArrowUp}')
    expect(protein).toHaveValue(1.7)
    await user.keyboard('{ArrowDown}')
    expect(protein).toHaveValue(1.6)
    await user.keyboard('{ArrowDown}')
    expect(protein).toHaveValue(1.5)
    await user.clear(protein)
    await user.type(protein, '1.65')
    await user.keyboard('{ArrowUp}')
    expect(protein).toHaveValue(1.75)
    await user.clear(protein)
    await user.type(protein, '5')
    await user.keyboard('{ArrowUp}')
    expect(protein).toHaveValue(5)
    await user.keyboard('{ArrowDown}')
    expect(protein).toHaveValue(4.9)
  })

  it.each(['.5', '5e-1'])('supports valid manual protein representation %s with controls and Arrow keys without normalizing on change', async (value) => {
    mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('form', { name: 'Nutrition preview' })
    const protein = screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' }) as HTMLInputElement
    const increase = screen.getByRole('button', { name: 'Increase protein by 0.1 g/kg/day' })
    const decrease = screen.getByRole('button', { name: 'Decrease protein by 0.1 g/kg/day' })
    fireEvent.change(protein, { target: { value } })
    expect(protein.value).toBe(value)
    expect(protein.valueAsNumber).toBe(0.5)
    expect(protein.validity.valid).toBe(true)
    expect(increase).toBeEnabled()
    expect(decrease).toBeEnabled()
    await user.click(increase)
    expect(protein.value).toBe('0.6')
    fireEvent.change(protein, { target: { value } })
    await user.click(decrease)
    expect(protein.value).toBe('0.4')
    fireEvent.change(protein, { target: { value } })
    await user.click(protein)
    await user.keyboard('{ArrowUp}')
    expect(protein.value).toBe('0.6')
    fireEvent.change(protein, { target: { value } })
    await user.keyboard('{ArrowDown}')
    expect(protein.value).toBe('0.4')
  })

  it('shows the strict protein review cue near either input but never for empty or technically invalid values', async () => {
    mockService()
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    const weight = screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' })
    const grams = screen.getByRole('spinbutton', { name: 'Protein (g/day)' })
    for (const [value, warns] of [['79.2', true], ['80', false], ['240', false], ['240.8', true], ['0', false], ['', false]] as const) {
      await user.clear(grams)
      if (value) await user.type(grams, value)
      if (warns) expect(screen.getByText(/outside the 1-3 g\/kg\/day product review band/)).toBeInTheDocument()
      else expect(screen.queryByText(/outside the 1-3 g\/kg\/day product review band/)).not.toBeInTheDocument()
    }
    await user.clear(weight)
    await user.type(weight, '70.1')
    for (const [value, warns] of [['70.09999999999998', true], ['70.1', false], ['70.10000000000001', false], ['210.29999999999998', false], ['210.3', false], ['210.30000000000004', true]] as const) {
      await user.clear(grams)
      await user.type(grams, value)
      expect(screen.queryByText(/outside the 1-3 g\/kg\/day product review band/) !== null).toBe(warns)
    }
    await user.click(screen.getByRole('radio', { name: 'Per kg of entered weight' }))
    const perKg = screen.getByRole('spinbutton', { name: 'Protein (g/kg/day)' })
    for (const [value, warns] of [['0.99', true], ['1', false], ['3', false], ['3.01', true], ['5.01', false]] as const) {
      await user.clear(perKg)
      await user.type(perKg, value)
      if (warns) expect(screen.getByText(/outside the 1-3 g\/kg\/day product review band/)).toBeInTheDocument()
      else expect(screen.queryByText(/outside the 1-3 g\/kg\/day product review band/)).not.toBeInTheDocument()
    }
    await user.clear(perKg)
    await user.type(perKg, '3.01')
    await user.clear(weight)
    expect(screen.queryByText(/outside the 1-3 g\/kg\/day product review band/)).not.toBeInTheDocument()
  })

  it.each([
    [70.1, false],
    [210.3, false],
    [70.09999999999998, true],
    [210.30000000000004, true],
  ])('uses accepted decimal inputs for the preview cue at %s g, not rounded macro totals or the draft weight', async (grams, warns) => {
    const accepted: PreviewResponse = {
      ...manualResult,
      inputs: { ...manualRequest, weight_kg: 70.1, strategy: { ...manualRequest.strategy, protein: { mode: 'daily_grams', g_per_day: grams } } },
      daily_target: { ...manualResult.daily_target, protein_g: Math.round(grams * 100) / 100 },
    }
    const fetchMock = mockService(() => Response.json(accepted))
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    const result = within(await screen.findByRole('region', { name: 'Provisional daily target preview' }))
    expect(result.queryByText(/outside the 1-3 g\/kg\/day product review band/) !== null).toBe(warns)
    expect(submittedRequests(fetchMock)[0]?.weight_kg).toBe(80)
  })

  it('does not block a technically valid high fixed-gram preview and uses the accepted response inputs for review', async () => {
    const highProtein: PreviewResponse = {
      ...manualResult,
      inputs: { ...manualRequest, strategy: { ...manualRequest.strategy, protein: { mode: 'daily_grams', g_per_day: 240.8 } } },
      daily_target: { ...manualResult.daily_target, protein_g: 240.8, carbohydrate_g: 179.2 },
    }
    const fetchMock = mockService(() => Response.json(highProtein))
    const user = userEvent.setup()
    renderPage()
    await fillManual(user)
    const protein = screen.getByRole('spinbutton', { name: 'Protein (g/day)' })
    await user.clear(protein)
    await user.type(protein, '240.8')
    expect(protein).toHaveAccessibleDescription(/outside the 1-3 g\/kg\/day product review band/)
    expect(protein).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    const result = within(await screen.findByRole('region', { name: 'Provisional daily target preview' }))
    expect(result.getByText(/outside the 1-3 g\/kg\/day product review band/)).toBeInTheDocument()
    expect(result.getByText('Protein').parentElement).toHaveTextContent('240.8 g/day')
    expect(submittedRequests(fetchMock)[0]?.strategy.protein).toEqual({ mode: 'daily_grams', g_per_day: 240.8 })
    await user.click(screen.getByRole('button', { name: 'Back to inputs' }))
    expect(screen.getByRole('button', { name: 'Continue to accepted preview' })).toBeInTheDocument()
    await user.clear(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }))
    expect(screen.queryByRole('button', { name: 'Continue to accepted preview' })).not.toBeInTheDocument()
  })

  it("does not reuse another session's nutrition options in a shared query client", async () => {
    mockService()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = renderPage(client)
    expect(await screen.findByRole('form', { name: 'Nutrition preview' })).toBeInTheDocument()
    auth.userId = 'another-user'
    auth.sessionId = 'session-b'
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    view.rerender(<QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>)
    expect(screen.queryByRole('form', { name: 'Nutrition preview' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading nutrition methods')
    client.clear()
  })
})
