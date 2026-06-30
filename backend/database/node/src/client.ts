/**
 * Parameterized data-access surface for Node Lambdas.
 *
 * The ONLY query entry points exposed to application code accept the SQL text
 * and a separate array of bind parameters. Values are sent to PostgreSQL as
 * bind parameters ($1, $2, ...) and are NEVER interpolated into the SQL string,
 * which prevents SQL injection (UBC CIC security steering / Requirement 39.2).
 */
import type { Sql, TransactionSql } from 'postgres';

export class DataAccess {
  public constructor(private readonly sql: Sql) {}

  /**
   * Run a parameterized query. `params` are bound positionally as $1..$N.
   *
   * @example
   *   await db.query(
   *     'SELECT * FROM app_user WHERE email = $1',
   *     [userSuppliedEmail],
   *   );
   */
  public async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const rows = await this.sql.unsafe(text, params as unknown as never[]);
    return rows as unknown as Row[];
  }

  /**
   * Run a parameterized statement and return the number of affected rows.
   */
  public async execute(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<number> {
    const result = await this.sql.unsafe(text, params as unknown as never[]);
    return result.count ?? 0;
  }

  /**
   * Run a set of operations inside a single transaction. The callback receives
   * a transaction-scoped handle; use `tx.unsafe(text, params)` for
   * parameterized statements within the transaction.
   */
  public async transaction<T>(
    fn: (tx: TransactionSql) => Promise<T>,
  ): Promise<T> {
    return this.sql.begin((tx) => fn(tx)) as Promise<T>;
  }

  /** Close all pooled connections (call on Lambda shutdown / in tests). */
  public async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
