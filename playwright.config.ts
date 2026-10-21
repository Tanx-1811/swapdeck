import { defineConfig } from '@playwright/test';
import type { ExtensionOptions } from './tests/e2e/fixtures';

/**
 * Two builds of the extension are tested:
 * - e2e: the e2e build, which has host access up front (as if the user had
 *   allowed every site), so switching can be exercised on the local test sites.
 * - store-build: the production build, exactly as installed from the store.
 */
export default defineConfig<ExtensionOptions>({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'e2e', testIgnore: /store-build|store-screenshots/, use: { extensionDir: 'dist-e2e' } },
    { name: 'store-build', testMatch: /store-build/, use: { extensionDir: 'dist' } },
    { name: 'screenshots', testMatch: /store-screenshots/, use: { extensionDir: 'dist-e2e' } },
    // Real sites over the network; run by hand (npm run test:live), never in CI.
    { name: 'live', testDir: 'tests/live', retries: 0, use: { extensionDir: 'dist-e2e' } },
  ],
});
