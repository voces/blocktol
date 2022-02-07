import SqlString from "https://esm.sh/sqlstring@2.3.2?pin=v64";

export const query = <T = unknown>(query: string): Promise<T> =>
  fetch("https://w3x.io/sql", {
    headers: {
      "x-dbproxy-user": "blocktol-dev",
      "x-dbproxy-password": Deno.env.get("SQL_PASSWORD")!,
      "x-dbproxy-database": "blocktol-dev",
    },
    method: "POST",
    body: query,
  }).then((r) => r.json());

export const sql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => query<T>(SqlString.format(strings.join("?"), values));

export const format = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => SqlString.format(strings.join("?"), values);

export type ExecResult = {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
};
