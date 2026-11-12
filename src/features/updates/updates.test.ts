import { describe, expect, test, vi } from 'vitest';
vi.mock('../../platform/bridge', () => ({ send: vi.fn(), isDesktop: false }));
vi.stubGlobal('localStorage', { getItem: () => null });
vi.stubGlobal('__APP_VERSION__', '1.0.0');
vi.stubGlobal('__APP_DISPLAY_VERSION__', 'Rev v1.0.0');
const { parseVersion, compareVersions, latestRelease, shouldPrompt } = await import('./updates');

describe('release selection and reminders', () => {
  test('compares numeric versions, not strings', () => {
    expect(compareVersions('v1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0+build', 'v1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
  });
  test('rejects malformed and unsafe version tags', () => {
    for (const tag of ['1.0', '01.0.0', '1.0.0-beta..1', '1.0.0-01', '../../2.0.0', '999999999999999999999.0.0']) expect(parseVersion(tag)).toBeNull();
  });
  test('finds highest newer stable release regardless of date order', () => {
    expect(latestRelease([{ tag_name: 'v1.1.0' }, { tag_name: 'v3.0.0', draft: true }, { tag_name: 'v4.0.0', prerelease: true }, { tag_name: 'v5.0.0-beta' }, { tag_name: 'v2.0.0' }], '1.0.0')?.tag_name).toBe('v2.0.0');
    expect(latestRelease([{ tag_name: 'v1.0.0' }, { tag_name: 'v0.9.0' }], '1.0.0')).toBeNull();
  });
  test('only a new major prompts and opt-out persists across future majors', () => {
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 0 }, '0.2.0', '1.0.0')).toBe(true);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 0 }, '1.0.0', '1.9.0')).toBe(false);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 2 }, '1.0.0', '2.1.0')).toBe(false);
    expect(shouldPrompt({ notifyMajor: false, promptedMajor: 2 }, '1.0.0', '3.0.0')).toBe(false);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 2 }, '1.0.0', '3.0.0')).toBe(true);
  });
});
