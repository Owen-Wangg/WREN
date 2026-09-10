/**
 * Parameterized data-access surface for Node Lambdas.
 *
 * The ONLY query entry points exposed to application code accept the SQL text
 * and a separate array of bind parameters. Values are sent to PostgreSQL as
 * bind parameters ($1, $2, ...) and are NEVER interpolated into the SQL string,
 * which prevents SQL injection (UBC CIC security steering / Requirement 39.2).
 */
import type { Sql } from 'postgres';

/** Parameterized query methods safe to expose inside a transaction callback. */
export interface TransactionDataAccess {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  execute(text: string, params?: readonly unknown[]): Promise<number>;
}

/** Minimal postgres.js surface shared by root and transaction connections. */
type ParameterizedSql = Pick<Sql, 'unsafe'>;

class ParameterizedDataAccess implements TransactionDataAccess {
  public constructor(private readonly sql: ParameterizedSql) {}

  public async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const rows = await this.sql.unsafe(text, params as unknown as never[]);
    return rows as unknown as Row[];
  }

  public async execute(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<number> {
    const result = await this.sql.unsafe(text, params as unknown as never[]);
    return result.count ?? 0;
  }
}

export class DataAccess extends ParameterizedDataAccess {
  public constructor(private readonly rootSql: Sql) {
    super(rootSql);
  }

  /**
   * Run operations inside one transaction. Only parameterized query methods are
   * exposed, so callback code cannot close the pool or open a nested transaction.
   */
  public async transaction<T>(
    fn: (tx: TransactionDataAccess) => Promise<T>,
  ): Promise<T> {
    return this.rootSql.begin((tx) => fn(new ParameterizedDataAccess(tx))) as Promise<T>;
  }

  /** Close all pooled connections (call on Lambda shutdown / in tests). */
  public async close(): Promise<void> {
    await this.rootSql.end({ timeout: 5 });
  }
}
