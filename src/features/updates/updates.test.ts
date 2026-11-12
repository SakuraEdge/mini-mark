import { describe, expect, test, vi } from 'vitest';
vi.mock('../../platform/bridge', () => ({ send: vi.fn(), isDesktop: false }));
vi.stubGlobal('localStorage', { getItem: () => null });
vi.stubGlobal('__APP_VERSION__', '4.0.1');
vi.stubGlobal('__APP_DISPLAY_VERSION__', 'Rev v1.0.1');
vi.stubGlobal('__APP_RELEASE_VERSION__', '1.0.1');
const { parseVersion, compareVersions, latestRelease, shouldPrompt, readSettings, releaseLabel } = await import('./updates');
const rev = (releaseVersion: string, version = '9.0.0') => ({ tag_name: `rev-v${releaseVersion}`, version, releaseVersion });

describe('release selection and reminders', () => {
  test('compares numeric versions, not strings', () => {
    expect(compareVersions('v1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0+build', 'v1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
  });
  test('rejects malformed and unsafe version tags', () => {
    for (const tag of ['1.0', '01.0.0', '1.0.0-beta..1', '1.0.0-01', '../../2.0.0', '999999999999999999999.0.0', '1.0.0\n', 'v1.0.0\r\n', '1.0.0\u2028']) expect(parseVersion(tag)).toBeNull();
  });
  test('finds highest newer stable release regardless of date order', () => {
    expect(latestRelease([{ tag_name: 'v1.1.0' }, { tag_name: 'v3.0.0', draft: true }, { tag_name: 'v4.0.0', prerelease: true }, { tag_name: 'v5.0.0-beta' }, { tag_name: 'v2.0.0' }], '1.0.0')?.tag_name).toBe('v2.0.0');
    expect(latestRelease([{ tag_name: 'v1.0.0' }, { tag_name: 'v0.9.0' }], '1.0.0')).toBeNull();
  });
  test('selects Rev releases by internal version while validating the public tag', () => {
    expect(latestRelease([rev('1.1.0', '4.0.2'), rev('2.0.0', '5.0.0'), { tag_name: 'v4.1.0' }], '4.0.1')?.tag_name).toBe('rev-v2.0.0');
    expect(latestRelease([rev('3.0.0', '4.0.0')], '4.0.1')).toBeNull();
    expect(latestRelease([rev('1.0.1', '4.0.1')], '4.0.0')?.tag_name).toBe('rev-v1.0.1');
    expect(latestRelease([rev('1.0.1', '4.0.2')], '4.0.1')?.tag_name).toBe('rev-v1.0.1');
    expect(latestRelease([rev('1.0.0', '4.0.2')], '4.0.1')).toBeNull();
    expect(releaseLabel({ ...rev('1.1.0', '4.0.2'), name: 'Mini Mark 4.0.2' })).toBe('Rev v1.1.0');
  });
  test('ignores invalid Rev metadata, mismatched tags, drafts and prereleases', () => {
    const invalid = [
      { tag_name: 'rev-v2.0.0' },
      { ...rev('2.0.0'), tag_name: 'rev-v3.0.0' },
      { ...rev('2.0.0'), version: 'v9.0.0' },
      { ...rev('2.0.0'), version: '9.0.0-beta' },
      { ...rev('2.0.0'), version: '999999999999999999999.0.0' },
      { ...rev('2.0.0'), tag_name: 'rev-v2.0.0\n' },
      { ...rev('2.0.0'), version: '9.0.0\n' },
      { ...rev('2.0.0'), releaseVersion: '2.0.0\n' },
      rev('2.0.0\n'), rev('2147483648.0.0'), rev('2.0.0', '2147483648.0.0'),
      rev('02.0.0'), rev('2.0.0-beta'), rev('../../2.0.0'),
      { ...rev('2.0.0'), draft: true }, { ...rev('2.0.0'), prerelease: true },
      { tag_name: 'v2.0.0', version: '9.0.0' }, { tag_name: 'v2.0.0', releaseVersion: '2.0.0' }, { tag_name: 'v9.0.0\n' }, { tag_name: 'v2147483648.0.0' },
    ];
    expect(latestRelease(invalid, '1.0.0')).toBeNull();
    expect(latestRelease([rev('2147483647.0.0', '2147483647.0.0')], '1.0.0')?.tag_name).toBe('rev-v2147483647.0.0');
  });
  test('only a new Rev major prompts and opt-out persists across future majors', () => {
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 0 }, '0.2.0', rev('1.0.0'))).toBe(true);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 0 }, '1.0.0', rev('1.9.0'))).toBe(false);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 2 }, '1.0.0', rev('2.1.0'))).toBe(false);
    expect(shouldPrompt({ notifyMajor: false, promptedMajor: 2 }, '1.0.0', rev('3.0.0'))).toBe(false);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 2 }, '1.0.0', rev('3.0.0'))).toBe(true);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 0 }, '1.0.0', { tag_name: 'v9.0.0' })).toBe(false);
    expect(shouldPrompt({ notifyMajor: true, promptedMajor: 0 }, '1.0.0', { ...rev('2.0.0'), tag_name: 'rev-v3.0.0' })).toBe(false);
  });
  test('migrates preferences without carrying over the legacy major counter', () => {
    const legacy = { auto: false, notifyMajor: false, lastAttempt: 1234, promptedMajor: 4 };
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'moye.updates.v1' ? JSON.stringify(legacy) : null });
    expect(readSettings()).toEqual({ auto: false, notifyMajor: false, lastAttempt: 1234, promptedMajor: 0 });
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'moye.updates.rev.v1' ? JSON.stringify({ ...legacy, promptedMajor: 2 }) : JSON.stringify(legacy) });
    expect(readSettings()).toEqual({ auto: false, notifyMajor: false, lastAttempt: 1234, promptedMajor: 2 });
  });
});
