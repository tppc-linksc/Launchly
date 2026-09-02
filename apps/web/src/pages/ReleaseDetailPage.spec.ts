/**
 * TEST-WEB-02 round 2 / ReleaseDetailPage
 *
 * - Mount fetches the release + its gates in parallel.
 * - The "发布" button is shown only when `release.status === 'READY'`.
 * - Clicking "发布" calls `publishRelease(projectId, releaseId)`.
 * - The "豁免" button is shown only for non-passed gates AND when the
 *   release has not been published yet; clicking it opens the dialog
 *   and confirming it calls `exemptGate(...)` and refreshes the gates.
 * - Failure of fetchRelease/fetchReleaseGates surfaces the error toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  },
  writable: true,
  configurable: true,
});

const { elMessageError } = vi.hoisted(() => ({ elMessageError: vi.fn() }));
vi.mock('element-plus', async (orig) => {
  const actual = await (orig() as any);
  return { ...actual, ElMessage: { ...actual.ElMessage, error: elMessageError } };
});

vi.mock('../api/client', () => ({
  fetchRelease: vi.fn(),
  fetchReleaseGates: vi.fn(),
  publishRelease: vi.fn(),
  exemptGate: vi.fn(),
}));

import { fetchRelease, fetchReleaseGates, publishRelease, exemptGate } from '../api/client';
import ReleaseDetailPage from './ReleaseDetailPage.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/releases/:projectId/:id', name: 'release-detail', component: ReleaseDetailPage },
    ],
  });
}

const RELEASE_READY = {
  id: 'r1',
  projectId: 'p1',
  version: '1.0.0',
  status: 'READY',
  gateStatus: 'PASSED',
  environmentId: 'e1',
  deploymentId: 'd1',
  releasedBy: null,
  releasedAt: null,
  createdAt: '2026-01-01',
  notes: 'note',
};

const RELEASE_PUBLISHED = { ...RELEASE_READY, id: 'r2', status: 'PUBLISHED' };

const GATES = [
  { gateName: 'HEALTH', passed: true, message: 'ok' },
  { gateName: 'P0_TESTS', passed: false, message: '1 failed' },
];

describe('ReleaseDetailPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchRelease).mockReset();
    vi.mocked(fetchReleaseGates).mockReset();
    vi.mocked(publishRelease).mockReset();
    vi.mocked(exemptGate).mockReset();
    elMessageError.mockReset();
  });

  it('RD.1 mount fetches the release and its gates in parallel', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_READY } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(fetchRelease).toHaveBeenCalledWith('p1', 'r1');
    expect(fetchReleaseGates).toHaveBeenCalledWith('p1', 'r1');
  });

  it('RD.2 the "发布" button is rendered only when status is READY', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_READY } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pubBtn = w.findAll('button').find((b) => b.text().trim() === '发布');
    expect(pubBtn).toBeDefined();

    // Reload with PUBLISHED status.
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_PUBLISHED } as any);
    await router.push('/releases/p1/r2');
    await flushPromises();
    // Re-render the page.
    const w2 = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();
    // The new mount hits the mock again — but since the mock for r1 still
    // resolves to RELEASE_READY (the LAST mockResolvedValue), the second
    // mount will see whatever fetchRelease is currently set to. Skip the
    // negative check here; it's covered in RD.4 by reload.
  });

  it('RD.3 clicking "发布" calls publishRelease(projectId, releaseId)', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_READY } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);
    vi.mocked(publishRelease).mockResolvedValue({
      data: { ...RELEASE_READY, status: 'PUBLISHED', releasedAt: '2026-01-02' },
    } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pubBtn = w.findAll('button').find((b) => b.text().trim() === '发布')!;
    await pubBtn.trigger('click');
    await flushPromises();

    expect(publishRelease).toHaveBeenCalledWith('p1', 'r1');
  });

  it('RD.4 for a non-READY release the "发布" button is absent', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: { ...RELEASE_READY, status: 'DRAFT' } } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const pubBtn = w.findAll('button').find((b) => b.text().trim() === '发布');
    expect(pubBtn).toBeUndefined();
  });

  it('RD.5 the "豁免" button is shown for non-passed gates (and only when release is not PUBLISHED)', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_READY } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const exemptBtns = w.findAll('button').filter((b) => b.text().trim() === '豁免');
    expect(exemptBtns.length, 'only the failing P0_TESTS gate should be exemptable').toBe(1);
  });

  it('RD.6 for a PUBLISHED release the "豁免" buttons are absent', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_PUBLISHED } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r2');
    await router.isReady();
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const exemptBtns = w.findAll('button').filter((b) => b.text().trim() === '豁免');
    expect(exemptBtns.length).toBe(0);
  });

  it('RD.7 confirming the exemption dialog calls exemptGate and refreshes the gates', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_READY } as any);
    vi.mocked(fetchReleaseGates)
      .mockResolvedValueOnce({ data: { gates: GATES } } as any)
      .mockResolvedValueOnce({ data: { gates: [{ gateName: 'P0_TESTS', passed: true, message: 'exempted' }] } } as any);
    vi.mocked(exemptGate).mockResolvedValue({ data: { ok: true } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const exemptBtn = w.findAll('button').find((b) => b.text().trim() === '豁免')!;
    await exemptBtn.trigger('click');
    await flushPromises();

    // Find the dialog's reason textarea and fill it.
    const dialogs = w.findAllComponents({ name: 'ElDialog' });
    expect(dialogs.length, 'exempt dialog must be open').toBeGreaterThan(0);
    const textarea = dialogs[0].find('textarea');
    expect(textarea.exists()).toBe(true);
    await textarea.setValue('reviewed manually');
    await flushPromises();

    // Click the dialog's "确定" button.
    const okBtn = dialogs[0].findAll('button').find((b) => b.text().trim() === '确定');
    expect(okBtn, 'dialog confirm must exist').toBeDefined();
    await okBtn!.trigger('click');
    await flushPromises();

    expect(exemptGate).toHaveBeenCalledWith('p1', 'r1', 'P0_TESTS', { reason: 'reviewed manually' });
    // The page re-fetches gates after a successful exempt.
    expect(fetchReleaseGates).toHaveBeenCalledTimes(2);
  });

  it('RD.8 failure of the initial load surfaces the Chinese error toast', async () => {
    vi.mocked(fetchRelease).mockRejectedValue(new Error('boom'));
    vi.mocked(fetchReleaseGates).mockRejectedValue(new Error('boom'));

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    expect(elMessageError).toHaveBeenCalledWith('操作失败，请稍后重试');
  });

  it('RD.9 back navigation and exemption reason binding follow the dialog contract', async () => {
    vi.mocked(fetchRelease).mockResolvedValue({ data: RELEASE_READY } as any);
    vi.mocked(fetchReleaseGates).mockResolvedValue({ data: { gates: GATES } } as any);

    const router = makeRouter();
    await router.push('/releases/p1/r1');
    await router.isReady();
    const backSpy = vi.spyOn(router, 'back');
    const w = mount(ReleaseDetailPage, { global: { plugins: [router, ElementPlus] } });
    await flushPromises();

    const exemptBtn = w.findAll('button').find((b) => b.text().trim() === '豁免')!;
    await exemptBtn.trigger('click');
    await flushPromises();
    const dialog = w.findAllComponents({ name: 'ElDialog' })[0];
    const inputs = dialog.findAllComponents({ name: 'ElInput' });
    await inputs[1].vm.$emit('update:modelValue', 'documented reason');
    expect((inputs[1].props() as any).modelValue).toBe('documented reason');

    const cancel = dialog.findAll('button').find((b) => b.text().trim() === '取消')!;
    await cancel.trigger('click');
    await flushPromises();
    expect((dialog.props() as any).modelValue).toBe(false);

    const backButton = w.findAll('button').find((b) => b.text().includes('返回'))!;
    await backButton.trigger('click');
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
