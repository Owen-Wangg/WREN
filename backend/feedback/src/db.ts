/**
 * Minimal parameterized data-access surface for the Feedback_Service.
 * The real `@wren/db-node` `DataAccess` satisfies this structurally, as does
 * any in-memory test fake.
 */
export interface QueryExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}
