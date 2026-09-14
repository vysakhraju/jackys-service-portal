import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AsyncSearchPicker } from './AsyncSearchPicker';

interface Hit {
  id: string;
  jobCardNumber: string;
}

const renderOption = (item: Hit) => item.jobCardNumber;
const getOptionLabel = (item: Hit) => item.jobCardNumber;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AsyncSearchPicker', () => {
  it('does not search below minChars', async () => {
    const search = vi.fn().mockResolvedValue([]);
    render(<AsyncSearchPicker onSelect={vi.fn()} search={search} renderOption={renderOption} getOptionLabel={getOptionLabel} minChars={2} />);

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'J' } });
    await vi.advanceTimersByTimeAsync(500);

    expect(search).not.toHaveBeenCalled();
    expect(screen.getByTestId('async-search-picker-options')).toHaveTextContent('Type at least 2 characters');
  });

  it('debounces: only fires the search once after typing settles', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'jc-1', jobCardNumber: 'JC-0120' }]);
    render(<AsyncSearchPicker onSelect={vi.fn()} search={search} renderOption={renderOption} getOptionLabel={getOptionLabel} debounceMs={300} />);

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'J' } });
    fireEvent.change(input, { target: { value: 'JC' } });
    fireEvent.change(input, { target: { value: 'JC-0120' } });

    await vi.advanceTimersByTimeAsync(299);
    expect(search).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('JC-0120');
  });

  it('renders results and calls onSelect with the full item on click', async () => {
    const item = { id: 'jc-1', jobCardNumber: 'JC-0120' };
    const search = vi.fn().mockResolvedValue([item]);
    const onSelect = vi.fn();
    render(<AsyncSearchPicker onSelect={onSelect} search={search} renderOption={renderOption} getOptionLabel={getOptionLabel} />);

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'JC-0120' } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText('JC-0120')).toBeInTheDocument());
    fireEvent.click(screen.getByText('JC-0120'));

    expect(onSelect).toHaveBeenCalledWith(item);
  });

  it('shows a no-matches message when the search resolves empty', async () => {
    const search = vi.fn().mockResolvedValue([]);
    render(<AsyncSearchPicker onSelect={vi.fn()} search={search} renderOption={renderOption} getOptionLabel={getOptionLabel} />);

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nomatch' } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByTestId('async-search-picker-options')).toHaveTextContent('No matches.'));
  });

  it('shows an error message and does not crash when the search rejects', async () => {
    const search = vi.fn().mockRejectedValue(new Error('network down'));
    render(<AsyncSearchPicker onSelect={vi.fn()} search={search} renderOption={renderOption} getOptionLabel={getOptionLabel} />);

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'JC-0120' } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByTestId('async-search-picker-options')).toHaveTextContent('Search failed'));
  });

  it('ignores a stale response from an earlier keystroke that resolves after a later one', async () => {
    let resolveFirst: (v: Hit[]) => void = () => {};
    const search = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Hit[]>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => Promise.resolve([{ id: 'jc-2', jobCardNumber: 'JC-0200' }]));

    render(<AsyncSearchPicker onSelect={vi.fn()} search={search} renderOption={renderOption} getOptionLabel={getOptionLabel} debounceMs={300} />);

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);

    // First query fires and is left pending.
    fireEvent.change(input, { target: { value: 'JC-01' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(search).toHaveBeenCalledTimes(1);

    // A second, later query resolves first.
    fireEvent.change(input, { target: { value: 'JC-02' } });
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => expect(screen.getByText('JC-0200')).toBeInTheDocument());

    // The stale first request finally resolves - must not clobber the newer results.
    resolveFirst([{ id: 'jc-1', jobCardNumber: 'JC-0100' }]);
    await Promise.resolve();

    expect(screen.getByText('JC-0200')).toBeInTheDocument();
    expect(screen.queryByText('JC-0100')).not.toBeInTheDocument();
  });

  // #218 pre-mortem follow-up (2026-09-14): lets a caller override the empty-results message
  // for a picker whose search() isn't a real free-text search (still supported for that
  // case, though JobCardsPage itself no longer needs it now that it has a real search).
  it('uses a custom emptyMessage when provided, instead of the generic "No matches."', async () => {
    const search = vi.fn().mockResolvedValue([]);
    render(
      <AsyncSearchPicker
        onSelect={vi.fn()}
        search={search}
        renderOption={renderOption}
        getOptionLabel={getOptionLabel}
        emptyMessage="No appointment found with that exact number."
      />,
    );

    const input = screen.getByTestId('async-search-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nomatch' } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() =>
      expect(screen.getByTestId('async-search-picker-options')).toHaveTextContent(
        'No appointment found with that exact number.',
      ),
    );
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument();
  });

  it('shows a fixed selected label with a Change action instead of the search box once something is selected', () => {
    const onClear = vi.fn();
    render(
      <AsyncSearchPicker
        onSelect={vi.fn()}
        search={vi.fn()}
        renderOption={renderOption}
        getOptionLabel={getOptionLabel}
        selectedLabel="JC-0120 - Ahmed Al Farsi"
        onClear={onClear}
      />,
    );

    expect(screen.queryByTestId('async-search-picker-input')).not.toBeInTheDocument();
    expect(screen.getByText('JC-0120 - Ahmed Al Farsi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Change'));
    expect(onClear).toHaveBeenCalled();
  });
});
