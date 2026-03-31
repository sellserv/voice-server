import pg from 'pg';
import type { DatabaseAdapter } from '../types.js';
import { translatePlaceholders } from './placeholder.js';

const { Pool } = pg;

export class PostgresAdapter implements DatabaseAdapter {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 20 });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await this.pool.query(translatePlaceholders(sql), params);
    return result.rows as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const result = await this.pool.query(translatePlaceholders(sql), params);
    return result.rows[0] as T | undefined;
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const translated = translatePlaceholders(sql);
    const isInsert = /^\s*INSERT/i.test(translated);

    let finalSql = translated;
    if (isInsert && !/RETURNING/i.test(translated)) {
      finalSql = translated + ' RETURNING id';
    }

    const result = await this.pool.query(finalSql, params);
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: result.rows[0]?.id ?? 0,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(translatePlaceholders(sql));
  }

  async transaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter: DatabaseAdapter = {
        query: async <U = any>(sql: string, params: any[] = []) => {
          const r = await client.query(translatePlaceholders(sql), params);
          return r.rows as U[];
        },
        queryOne: async <U = any>(sql: string, params: any[] = []) => {
          const r = await client.query(translatePlaceholders(sql), params);
          return r.rows[0] as U | undefined;
        },
        run: async (sql: string, params: any[] = []) => {
          const translated = translatePlaceholders(sql);
          const isInsert = /^\s*INSERT/i.test(translated);
          let finalSql = translated;
          if (isInsert && !/RETURNING/i.test(translated)) {
            finalSql = translated + ' RETURNING id';
          }
          const r = await client.query(finalSql, params);
          return { changes: r.rowCount ?? 0, lastInsertRowid: r.rows[0]?.id ?? 0 };
        },
        exec: async (sql: string) => {
          await client.query(translatePlaceholders(sql));
        },
        transaction: async () => {
          throw new Error('Nested transactions not supported');
        },
        close: async () => {},
      };
      const result = await fn(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
