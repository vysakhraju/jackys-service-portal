import { types as pgTypes } from 'pg';

// 2026-09-08 live-testing bug: node-postgres returns Postgres NUMERIC/DECIMAL columns as
// strings by default (to avoid silent float precision loss), but every entity in this app
// declares its `decimal` columns as TS `number` (e.g. TechnicianVisit.startGpsLat/Lng,
// every money field across invoicing/estimates/AMC/etc.), and the frontend calls real
// number methods on them (.toFixed(), Math, arithmetic) - so without this, any screen
// reading a populated decimal column throws a TypeError and blanks the whole page (no
// error boundary is configured anywhere in the frontend). Safe app-wide here because none
// of these columns are ever used at a precision JS's float64 can't hold (currency to 2dp,
// GPS to 7dp) - if that ever changes, that one column should get its own TypeORM
// `transformer` instead of relying on this global parser. OID 1700 = NUMERIC (pg-types).
//
// Must run before TypeORM opens its first connection - main.ts calls this at the very top
// of bootstrap(), before NestFactory.create(). Exported as its own function (rather than a
// bare module-level side effect) purely so it's unit-testable without booting the whole
// Nest app or touching a real Postgres connection.
export function registerPgTypeParsers(): void {
  pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (value: string) => parseFloat(value));
}
