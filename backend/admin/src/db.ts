/**
 * Minimal parameterized data-access surface used by the Admin_Service.
 *
 * The real `@wren/db-node` `DataAccess` satisfies this structurally
 * (`query<Row>(text, params)` + `execute(text, params)`), and so does any test
 * fake — so the services depend on the shape, not the concrete class. Every
 * value is sent to PostgreSQL as a bind parameter ($1..$N); no value is ever
 * interpolated into SQL text (UBC CIC security steering / Requirement 39.2).
 */
export interface QueryExecutor {
  /** Run a parameterized query and return the resulting rows. */
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}
