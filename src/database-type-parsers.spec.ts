import { types as pgTypes } from 'pg';
import { registerPgTypeParsers } from './database-type-parsers';

// Regression test for the 2026-09-08 live-testing bug: a decimal column (e.g.
// TechnicianVisit.startGpsLat) coming back from Postgres as a string instead of a number
// crashed the frontend's ViewAppointmentModal (.toFixed() on a string throws, blanking the
// whole page with no error boundary to catch it). This just asserts the NUMERIC type
// parser is registered and behaves the way every entity's `number`-typed decimal column
// assumes - it can't spin up a real Postgres connection to prove TypeORM uses it end to
// end, but pg's type-parser registry is exactly what node-postgres consults for every row.
describe('registerPgTypeParsers', () => {
  const NUMERIC_OID = pgTypes.builtins.NUMERIC;

  it('registers a parser for the NUMERIC OID that converts the raw string to a real number', () => {
    registerPgTypeParsers();

    const parser = pgTypes.getTypeParser(NUMERIC_OID);
    expect(typeof parser).toBe('function');

    const parsed = (parser as (value: string) => unknown)('25.1234567');
    expect(parsed).toBe(25.1234567);
    expect(typeof parsed).toBe('number');
  });

  it('parses a plain-integer-looking decimal string (e.g. a whole-dollar amount) as a number too', () => {
    registerPgTypeParsers();

    const parser = pgTypes.getTypeParser(NUMERIC_OID) as (value: string) => unknown;
    expect(parser('470.00')).toBe(470);
    expect(parser('0.00')).toBe(0);
  });

  it('is idempotent - calling it more than once (as NestJS hot-reload or repeated bootstrap calls might) leaves the same correct behavior', () => {
    registerPgTypeParsers();
    registerPgTypeParsers();

    const parser = pgTypes.getTypeParser(NUMERIC_OID) as (value: string) => unknown;
    expect(parser('12.5')).toBe(12.5);
  });
});
