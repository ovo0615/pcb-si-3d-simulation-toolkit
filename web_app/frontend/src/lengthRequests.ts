import type { DisplayLengthUnit } from './lengthUnits'

/** 只附加展示 metadata；不改任何幾何、快取、原 API 或檔案的數值語意。 */
const endpoints = new Set([
  '/api/load', '/api/reload_original', '/api/preview', '/api/cutout', '/api/cutout/preview_boundary', '/api/cutout/preview_boundary/start', '/api/ports_setup', '/api/stackup/apply',
  '/api/backdrill/analyze', '/api/backdrill/apply', '/api/cleanup/analyze', '/api/cleanup/run',
  '/api/segment/analyze', '/api/segment/analyze-complexity', '/api/segment/run', '/api/segment/run-single',
  '/api/schedule/start', '/api/tdr/start', '/api/tdr/measured/analyze', '/api/tdr/path', '/api/tdr/map',
  '/api/cross-section/scan', '/api/cross-section/solve', '/api/cross-section/from-tdr', '/api/cross-section/compare',
])
export function lengthRequest(url: string, body: unknown, unit: DisplayLengthUnit): unknown {
  return endpoints.has(url) && body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body, length_unit: unit } : body
}
