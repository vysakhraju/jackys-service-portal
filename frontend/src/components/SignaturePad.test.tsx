import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignaturePad } from './SignaturePad';

// jsdom has no real 2D canvas backend (no `canvas` npm package installed) - getContext('2d')
// returns null and setPointerCapture()/a meaningful toDataURL() aren't implemented at all.
// First canvas-based component in this codebase, so there's no existing mock precedent to
// follow (Frontend Phase 12's websocket mock was in the same position) - this builds the
// minimal fake context/geometry SignaturePad actually calls, using direct prototype
// assignment (not vi.spyOn+restore) since vitest isolates each test file's module graph by
// default, so nothing here leaks into other files.
const fakeCtx = {
  scale: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
  lineWidth: 0,
  lineCap: '',
  lineJoin: '',
  strokeStyle: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(fakeCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,FAKE_SIGNATURE');
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 112, width: 300, height: 112, toJSON: () => {},
  });
});

function draw(canvas: HTMLElement, points: { x: number; y: number }[]) {
  fireEvent.pointerDown(canvas, { clientX: points[0].x, clientY: points[0].y, pointerId: 1 });
  for (const p of points.slice(1)) {
    fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y, pointerId: 1 });
  }
  fireEvent.pointerUp(canvas, { clientX: points[points.length - 1].x, clientY: points[points.length - 1].y, pointerId: 1 });
}

describe('SignaturePad - empty state', () => {
  it('renders a "Sign here" placeholder and never calls onChange before anything is drawn', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    expect(screen.getByText('Sign here')).toBeInTheDocument();
    expect(screen.getByText('Draw a signature above')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});

describe('SignaturePad - drawing a real signature', () => {
  it('calls onChange with the canvas data URL once a real stroke is drawn', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature pad, empty' });

    draw(canvas, [{ x: 10, y: 10 }, { x: 60, y: 60 }]); // well over the minimum drawn distance

    expect(onChange).toHaveBeenCalledWith('data:image/png;base64,FAKE_SIGNATURE');
    expect(screen.getByText('Signature captured')).toBeInTheDocument();
    expect(screen.queryByText('Sign here')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('accumulates distance across multiple small moves within one stroke', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature pad, empty' });

    // Several short segments whose individual lengths are tiny but sum past the minimum.
    draw(canvas, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 20, y: 0 }, { x: 25, y: 0 }]);

    expect(onChange).toHaveBeenCalledWith('data:image/png;base64,FAKE_SIGNATURE');
  });
});

describe('SignaturePad - dirty-check for accidental taps (the-fool finding)', () => {
  it('does NOT call onChange for a stray tap/jitter below the minimum drawn distance', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature pad, empty' });

    draw(canvas, [{ x: 10, y: 10 }, { x: 11, y: 10 }]); // 1px - an accidental tap/jitter

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Sign here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('does NOT call onChange for a plain pointerdown/pointerup with no movement at all', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature pad, empty' });

    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 50, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SignaturePad - Clear', () => {
  it('resets to empty, calls onChange(undefined), and re-clears the canvas', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature pad, empty' });
    draw(canvas, [{ x: 10, y: 10 }, { x: 60, y: 60 }]);
    onChange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('Sign here')).toBeInTheDocument();
    expect(fakeCtx.clearRect).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('a fresh stroke after Clear can produce a signature again', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Signature pad, empty' });
    draw(canvas, [{ x: 10, y: 10 }, { x: 60, y: 60 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    onChange.mockClear();

    draw(canvas, [{ x: 5, y: 5 }, { x: 80, y: 80 }]);

    expect(onChange).toHaveBeenCalledWith('data:image/png;base64,FAKE_SIGNATURE');
    expect(screen.getByText('Signature captured')).toBeInTheDocument();
  });
});

describe('SignaturePad - mobile/touch correctness (the-fool findings)', () => {
  it('sizes the canvas drawing buffer by devicePixelRatio, not the raw CSS size', () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });

    const { container } = render(<SignaturePad onChange={vi.fn()} />);
    const canvas = container.querySelector('canvas')!;

    expect(canvas.width).toBe(300 * 3);
    expect(canvas.height).toBe(112 * 3);
    expect(fakeCtx.scale).toHaveBeenCalledWith(3, 3);

    Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
  });

  it('sets touch-action: none on the drawing surface so page scroll cannot hijack a signature mid-stroke', () => {
    render(<SignaturePad onChange={vi.fn()} />);
    expect(screen.getByTestId('signature-pad-surface')).toHaveStyle({ touchAction: 'none' });
  });
});
