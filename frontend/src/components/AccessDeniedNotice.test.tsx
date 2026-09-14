import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccessDeniedNotice } from './AccessDeniedNotice';

describe('AccessDeniedNotice', () => {
  it('names the section that was blocked in its message', () => {
    render(<AccessDeniedNotice what="Master Data" />);
    expect(screen.getByText("You don't have access to Master Data yet.")).toBeInTheDocument();
  });

  it('points at Users → Designation access as the way to get it, and notes it needs no re-login', () => {
    render(<AccessDeniedNotice what="Reports & Dashboards" />);
    expect(screen.getByText(/Users → Designation access/)).toBeInTheDocument();
    expect(screen.getByText(/no re-login needed/)).toBeInTheDocument();
  });
});
