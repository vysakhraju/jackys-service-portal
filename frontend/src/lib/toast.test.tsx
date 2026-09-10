import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, notifySaveSuccess, useToast } from './toast';

function Trigger({ toast }: { toast: Parameters<ReturnType<typeof useToast>['push']>[0] }) {
  const { push } = useToast();
  return <button onClick={() => push(toast)}>fire</button>;
}

function renderWithProvider(toast: Parameters<ReturnType<typeof useToast>['push']>[0]) {
  return render(
    <ToastProvider>
      <Trigger toast={toast} />
    </ToastProvider>,
  );
}

describe('toast - useToast outside a provider', () => {
  it('throws a clear error rather than silently no-op-ing', () => {
    function Bare() {
      useToast();
      return null;
    }
    // Suppress the expected React error-boundary console.error noise for this one assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow('useToast must be used within a ToastProvider');
    spy.mockRestore();
  });
});

describe('toast - push/render/dismiss', () => {
  it('renders nothing in the toast stack until push is called', () => {
    renderWithProvider({ title: 'New Need Spare request' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a pushed toast with its title and description', async () => {
    renderWithProvider({ title: 'New Need Spare request', description: '2 × Drum Belt for job card JC-0001' });
    const user = userEvent.setup();
    await user.click(screen.getByText('fire'));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText('New Need Spare request')).toBeInTheDocument();
    expect(screen.getByText('2 × Drum Belt for job card JC-0001')).toBeInTheDocument();
  });

  it('omits the description paragraph when none is given', async () => {
    renderWithProvider({ title: 'New Need Spare request' });
    const user = userEvent.setup();
    await user.click(screen.getByText('fire'));

    await screen.findByRole('status');
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(1);
  });

  it('dismisses the toast when its dismiss button is clicked', async () => {
    renderWithProvider({ title: 'New Need Spare request' });
    const user = userEvent.setup();
    await user.click(screen.getByText('fire'));
    await screen.findByRole('status');

    await user.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders an action button and both fires its onClick and dismisses the toast when clicked', async () => {
    const onClick = vi.fn();
    renderWithProvider({ title: 'New Need Spare request', action: { label: 'Review', onClick } });
    const user = userEvent.setup();
    await user.click(screen.getByText('fire'));
    await screen.findByRole('status');

    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stacks multiple pushed toasts independently', async () => {
    function MultiTrigger() {
      const { push } = useToast();
      return (
        <button
          onClick={() => {
            push({ title: 'First' });
            push({ title: 'Second' });
          }}
        >
          fire both
        </button>
      );
    }
    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText('fire both'));

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});

describe('toast - notifySaveSuccess (non-component bridge used by lib/api.ts)', () => {
  it('is a safe no-op when no ToastProvider is mounted', () => {
    expect(() => notifySaveSuccess()).not.toThrow();
  });

  it('renders a toast with the default title when a ToastProvider is mounted', async () => {
    render(
      <ToastProvider>
        <div />
      </ToastProvider>,
    );
    notifySaveSuccess();
    expect(await screen.findByText('Saved successfully.')).toBeInTheDocument();
  });

  it('renders a toast with a custom message when one is passed', async () => {
    render(
      <ToastProvider>
        <div />
      </ToastProvider>,
    );
    notifySaveSuccess('Estimate sent to customer.');
    expect(await screen.findByText('Estimate sent to customer.')).toBeInTheDocument();
  });

  it('stops firing once the ToastProvider unmounts', () => {
    const { unmount } = render(
      <ToastProvider>
        <div />
      </ToastProvider>,
    );
    unmount();
    expect(() => notifySaveSuccess()).not.toThrow();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('toast - auto-dismiss timing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-dismisses after the default 8000ms', async () => {
    renderWithProvider({ title: 'New Need Spare request' });
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByText('fire'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(7999);
    expect(screen.getByRole('status')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('honors a custom durationMs instead of the default', async () => {
    renderWithProvider({ title: 'New Need Spare request', durationMs: 1000 });
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByText('fire'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('does not error when manually dismissed before its auto-dismiss timer fires', async () => {
    renderWithProvider({ title: 'New Need Spare request' });
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByText('fire'));
    await user.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // The (now-cleared) auto-dismiss timer firing later must not throw or double-remove.
    await vi.advanceTimersByTimeAsync(8000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
