import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NamePicker } from './NamePicker';

const options = [
  { id: 'sc-1', name: 'Dubai Service Centre' },
  { id: 'sc-2', name: 'Sharjah Service Centre' },
  { id: 'sc-3', name: 'Abu Dhabi Service Centre' },
];

describe('NamePicker', () => {
  it('shows the selected option name, not its id, when a value is set', () => {
    render(<NamePicker value="sc-2" onChange={vi.fn()} options={options} />);
    expect(screen.getByTestId('name-picker-input')).toHaveValue('Sharjah Service Centre');
  });

  it('shows an empty input when no value is selected', () => {
    render(<NamePicker value={null} onChange={vi.fn()} options={options} />);
    expect(screen.getByTestId('name-picker-input')).toHaveValue('');
  });

  it('opens the option list on focus and lists everything with an empty query', () => {
    render(<NamePicker value={null} onChange={vi.fn()} options={options} />);
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    const list = screen.getByTestId('name-picker-options');
    expect(list).toHaveTextContent('Dubai Service Centre');
    expect(list).toHaveTextContent('Sharjah Service Centre');
    expect(list).toHaveTextContent('Abu Dhabi Service Centre');
  });

  it('filters options case-insensitively as the user types', () => {
    render(<NamePicker value={null} onChange={vi.fn()} options={options} />);
    const input = screen.getByTestId('name-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'sharjah' } });

    const list = screen.getByTestId('name-picker-options');
    expect(list).toHaveTextContent('Sharjah Service Centre');
    expect(list).not.toHaveTextContent('Dubai Service Centre');
    expect(list).not.toHaveTextContent('Abu Dhabi Service Centre');
  });

  it('calls onChange with the id (not the name) when an option is clicked, and closes the list', () => {
    const onChange = vi.fn();
    render(<NamePicker value={null} onChange={onChange} options={options} />);
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    fireEvent.click(screen.getByText('Sharjah Service Centre'));

    expect(onChange).toHaveBeenCalledWith('sc-2');
    expect(screen.queryByTestId('name-picker-options')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when nothing matches the query', () => {
    render(<NamePicker value={null} onChange={vi.fn()} options={options} emptyMessage="Nothing found." />);
    const input = screen.getByTestId('name-picker-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz-no-match' } });

    expect(screen.getByTestId('name-picker-options')).toHaveTextContent('Nothing found.');
  });

  it('shows a clear (×) button when a value is selected, and calls onChange(null) on click', () => {
    const onChange = vi.fn();
    render(<NamePicker value="sc-1" onChange={onChange} options={options} />);

    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not show a clear button when allowClear is false', () => {
    render(<NamePicker value="sc-1" onChange={vi.fn()} options={options} allowClear={false} />);
    expect(screen.queryByLabelText('Clear selection')).not.toBeInTheDocument();
  });

  it('shows a loading placeholder and disables the input while loading', () => {
    render(<NamePicker value={null} onChange={vi.fn()} options={[]} loading />);
    const input = screen.getByTestId('name-picker-input');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Loading…');
  });

  it('renders an optional subtext next to each option', () => {
    render(
      <NamePicker
        value={null}
        onChange={vi.fn()}
        options={[{ id: 'm-1', name: 'WA80J5710' }]}
        getOptionSubtext={(o) => `model ${o.id}`}
      />,
    );
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    expect(screen.getByTestId('name-picker-options')).toHaveTextContent('model m-1');
  });

  // #218 pre-mortem follow-up (2026-09-14): re-focusing an already-filled field used to
  // blank the input immediately, which read as "did I just lose my selection?" even though
  // nothing was actually lost - the most likely "looks broken but isn't" issue left across
  // the whole #218 conversion, since it affects every NamePicker on every page.
  it('shows the current selection (not a blank input) when an already-filled field is re-focused, with the full list still browsable', () => {
    render(<NamePicker value="sc-2" onChange={vi.fn()} options={options} />);
    const input = screen.getByTestId('name-picker-input');

    fireEvent.focus(input);

    expect(input).toHaveValue('Sharjah Service Centre');
    const list = screen.getByTestId('name-picker-options');
    expect(list).toHaveTextContent('Dubai Service Centre');
    expect(list).toHaveTextContent('Sharjah Service Centre');
    expect(list).toHaveTextContent('Abu Dhabi Service Centre');
  });

  it('still filters normally once the user actually types after re-focusing a filled field', () => {
    render(<NamePicker value="sc-2" onChange={vi.fn()} options={options} />);
    const input = screen.getByTestId('name-picker-input');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'dubai' } });

    const list = screen.getByTestId('name-picker-options');
    expect(list).toHaveTextContent('Dubai Service Centre');
    expect(list).not.toHaveTextContent('Sharjah Service Centre');
    expect(list).not.toHaveTextContent('Abu Dhabi Service Centre');
  });

  it('closes the option list when clicking outside the component', () => {
    render(
      <div>
        <NamePicker value={null} onChange={vi.fn()} options={options} />
        <button>outside</button>
      </div>,
    );
    fireEvent.focus(screen.getByTestId('name-picker-input'));
    expect(screen.getByTestId('name-picker-options')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByTestId('name-picker-options')).not.toBeInTheDocument();
  });
});
