import SqlString from "https://esm.sh/sqlstring@2.3.2?pin=v64";

const query = async <T = unknown>(query: string, retries = 1): Promise<T> => {
  const makeFetch = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const ret = await fetch("https://w3x.io/sql", {
      headers: {
        "x-dbproxy-user": "blocktol-dev",
        "x-dbproxy-password": Deno.env.get("SQL_PASSWORD")!,
        "x-dbproxy-database": "blocktol-dev",
      },
      method: "POST",
      body: query,
      signal: controller.signal,
    }).catch((err) => err);
    if (ret instanceof Error) {
      if (ret.message === "The signal has been aborted") {
        throw new Error("Timeout", { cause: ret });
      }
      throw ret;
    }
    clearTimeout(timeout);

    return ret;
  };

  let lastError: Error | undefined;

  while (retries-- >= 0) {
    try {
      const ret = await makeFetch();
      return ret.json();
    } catch (err) {
      lastError = err;
      console.error(err);
      console.error(
        new Date(),
        "Error fetching,",
        retries + 1,
        "retries remaining",
      );
    }
  }

  throw new Error("Failed to fetch", { cause: lastError });
};

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
