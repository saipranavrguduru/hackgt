export function providerReadiness(mode = process.env.PERKPILOT_MODE || 'demo') {
  const required = ['production identity', 'transactional storage', 'finance connection', 'verified offer feed', 'catalog evidence provider', 'approved payment sandbox', 'signed reward events'];
  return { mode, ready: mode === 'demo', synthetic: mode === 'demo', missing: mode === 'demo' ? [] : required,
    message: mode === 'demo' ? 'Local synthetic demo; no money moves.' : 'Live providers are unavailable. Synthetic responses are disabled.' };
}
