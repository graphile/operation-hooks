// tslint:disable no-console array-type prefer-conditional-expression
import { graphql, GraphQLSchema, GraphQLError } from "graphql";
import { Plugin } from "graphile-build";
import {
  createPostGraphileSchema,
  withPostGraphileContext,
} from "postgraphile";
import { GraphQLResolveInfoWithMessages } from "../OperationMessagesPlugin";
import OperationHooksPlugin from "../OperationHooksPlugin";
import { makeHookPlugin } from "./common";
import { Pool, PoolClient } from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL envvar must be set");
}

jest.setTimeout(10000);

function sqlSearchPath(sql1: string, sql2?: string) {
  return `
  begin;
  ${sql2 != null ? sql1 : ""}
  set local search_path to operation_hooks;
  ${sql2 != null ? sql2 : sql1}
  commit;
  `;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let pgPool: Pool;

beforeAll(async () => {
  pgPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  try {
    await pgPool.query(
      sqlSearchPath(
        `
  drop schema if exists operation_hooks cascade;
  create schema operation_hooks;`,
        `
  create table users (
    id serial primary key,
     name text not null,
     country_code text not null,
     country_identification_number text not null,
     unique (country_code, country_identification_number)
  );

  create function uppercase_name() returns trigger as $$
    begin
      NEW.name = upper(NEW.name);
      return NEW;
    end;
  $$ language plpgsql;
  create trigger _200_uppercase_name before insert or update on users for each row execute procedure uppercase_name();

  insert into users (id, name, country_code, country_identification_number) values
    (1, 'Uzr Vun', 'UK', '123456789');

  select setval('users_id_seq', 1000);

  create type mutation_message as (
    level text,
    message text,
    path text[],
    code text
  );

  `
      )
    );
    // Synchronisation time?
    await sleep(1000);
  } catch (e) {
    console.error("Error when setting SQL search path");
    console.dir(e);
    throw e;
  }
}, 20000);

afterAll(() => {
  pgPool.end();
});

const setupTeardownFunctions = (...sqlDefs: string[]) => {
  const before: string[] = [];
  const after: string[] = [];
  const funcArgses: string[] = [];
  const funcReturnses: string[] = [];
  sqlDefs.forEach((sqlDef) => {
    const matches = sqlDef.match(
      /create function ([a-z0-9_]+)\(([^)]*)\) (?:returns ([\s\S]*) )?as \$\$/
    );
    if (!matches) {
      throw new Error(`Don't understand SQL definition ${sqlDef}!`);
    }
    const [, funcName, funcArgs, funcReturns] = matches;
    const dropSql = `drop function ${funcName}(${funcArgs});`;
    const omitSql = `comment on function ${funcName}(${funcArgs}) is E'@omit';`;
    before.push(`${sqlDef};${omitSql};`);
    after.push(dropSql);
    funcArgses.push(funcArgs);
    funcReturnses.push(funcReturns);
  });

  return {
    sqlSetup: sqlSearchPath(before.join(";")),
    sqlTeardown: sqlSearchPath(after.reverse().join(";")),
    funcArgses,
    funcReturnses,
  };
};

function snapshotSanitise(o: any): any {
  if (Array.isArray(o)) {
    return o.map(snapshotSanitise);
  } else if (o && typeof o === "object") {
    const result = {};
    // tslint:disable-next-line forin
    for (const key in o) {
      const val = o[key];
      if (key === "id" && typeof val === "number") {
        result[key] = "[NUMBER]";
      } else if (key === "nodeId" && typeof val === "string") {
        result[key] = "[NodeId]";
      } else {
        result[key] = snapshotSanitise(val);
      }
    }
    return result;
  } else {
    return o;
  }
}

async function withTransaction<T>(
  pool: Pool,
  cb: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  await client.query("begin");
  try {
    return await cb(client);
  } finally {
    await client.query("rollback");
    await client.release();
  }
}

function postgraphql(
  schema: GraphQLSchema,
  query: string,
  rootValue?: any,
  context?: any,
  variables?: {
    [key: string]: any;
  } | null,
  operationName?: string
) {
  return withPostGraphileContext(
    {
      pgPool,
    },
    (postgraphileContext: {}) =>
      withTransaction(pgPool, (pgClient) =>
        graphql(
          schema,
          query,
          rootValue,
          {
            ...postgraphileContext,
            pgClient,
            ...context,
          },
          variables,
          operationName
        )
      )
  );
}

const getPostGraphileSchema = (plugins: Plugin[] = []) =>
  createPostGraphileSchema(pgPool, "operation_hooks", {
    graphileBuildOptions: {
      operationMessages: true,
      operationMessagesPreflight: true,
    },
    appendPlugins: [OperationHooksPlugin, ...plugins],
  });

function argVariants(
  base: string,
  type: string,
  rawPrefix = ""
): {
  op: "insert" | "update" | "delete";
  sqlDefs: string[];
  argCount: number;
}[] {
  const prefix = rawPrefix ? rawPrefix + " " : "";
  const addWhen = (when: string) => (sql: string) =>
    sql.replace(/%WHEN%/g, when);
  const addBefore = addWhen("before");
  const addAfter = addWhen("after");
  const variantsForOp = (op: "insert" | "update" | "delete") => {
    return [
      { args: `` },
      { args: `${prefix}data json` },
      { args: `${prefix}data jsonb` },
      { args: `${prefix}data json, ${prefix}tuple ${type}` },
      { args: `${prefix}data jsonb, ${prefix}tuple ${type}` },
      {
        args: `${prefix}data json, ${prefix}tuple ${type}, ${prefix}operation text`,
      },
    ].map(({ args }) => {
      const argCount =
        args.trim().length === 0 ? 0 : args.replace(/[^,]/g, "").length + 1;
      let msg = "";
      if (argCount === 0) {
        msg = ` || ' (no args)'`;
      } else {
        if (argCount >= 1) {
          msg += ` || '; name: ' || coalesce((data ->> 'name'), '¤') || ''`;
        }
        if (argCount >= 2) {
          msg += ` || ' (tuple.name: ' || coalesce(tuple.name, '¤') || ')'`;
        }
        if (argCount >= 3) {
          msg += ` || ' (operation: ' || operation || ')'`;
        }
      }
      const sqlDef = base
        .replace(args.length ? /___/ : /___,?/, args)
        .replace(/%MSG%/g, msg)
        .replace(/%OP%/g, op);
      return {
        op,
        sqlDefs: [addBefore(sqlDef), addAfter(sqlDef)],
        argCount,
      };
    });
  };
  return [
    ...variantsForOp("insert"),
    ...variantsForOp("update"),
    ...variantsForOp("delete"),
  ];
}

const equivalentFunctions = [
  ...argVariants(
    `\
create function users_%OP%_%WHEN%(___) returns setof mutation_message as $$
begin
  raise debug '%', json_build_object(
    'f', 'NOTICE',
    'l', 'info',
    'm', '' %MSG%,
    'w', '%WHEN%',
    'o', '%OP%',
    'c', 'INFO1',
    'p', array_to_json(ARRAY['name'])
  )::text using errcode = 'GOPHK';

  return next row(
    'info',
    '%WHEN% user %OP% mutation' %MSG%,
    ARRAY['name'],
    'INFO1'
  )::mutation_message;

  return;
end;
$$ language plpgsql volatile set search_path from current;
`,
    "users"
  ),
  ...argVariants(
    `\
create function users_%OP%_%WHEN%(___) returns mutation_message[] as $$
begin
  raise debug '%', json_build_object(
    'f', 'NOTICE',
    'l', 'info',
    'm', '' %MSG%,
    'w', '%WHEN%',
    'o', '%OP%',
    'c', 'INFO1',
    'p', array_to_json(ARRAY['name'])
  )::text using errcode = 'GOPHK';

  return ARRAY[row(
    'info',
    '%WHEN% user %OP% mutation' %MSG%,
    ARRAY['name'],
    'INFO1'
  )::mutation_message];
end;
$$ language plpgsql volatile set search_path from current;
`,
    "users"
  ),
  ...argVariants(
    `\
create function users_%OP%_%WHEN%(___) returns table(
  level text,
  message text,
  path text[],
  code text
) as $$
begin
  raise debug '%', json_build_object(
    'f', 'NOTICE',
    'l', 'info',
    'm', '' %MSG%,
    'w', '%WHEN%',
    'o', '%OP%',
    'c', 'INFO1',
    'p', array_to_json(ARRAY['name'])
  )::text using errcode = 'GOPHK';

  level = 'info';
  message = '%WHEN% user %OP% mutation' %MSG%;
  path = ARRAY['name'];
  code = 'INFO1';
  return next;

  return;
end;
$$ language plpgsql volatile set search_path from current;
`,
    "users"
  ),
  ...argVariants(
    `
create function users_%OP%_%WHEN%(
  ___,
  out level text,
  out message text,
  out path text[],
  out code text
) as $$
begin
  raise debug '%', json_build_object(
    'f', 'NOTICE',
    'l', 'info',
    'm', '' %MSG%,
    'w', '%WHEN%',
    'o', '%OP%',
    'c', 'INFO1',
    'p', array_to_json(ARRAY['name'])
  )::text using errcode = 'GOPHK';

  level = 'info';
  message = '%WHEN% user %OP% mutation' %MSG%;
  path = ARRAY['name'];
  code = 'INFO1';

end;
$$ language plpgsql volatile set search_path from current;
`,
    "users",
    "in"
  ),
];

describe("equivalent functions", () => {
  equivalentFunctions.forEach(({ op, sqlDefs, argCount }) => {
    const {
      sqlSetup,
      sqlTeardown,
      funcArgses: [funcArgs],
      funcReturnses: [funcReturns],
    } = setupTeardownFunctions(...sqlDefs);
    describe(`${op} hook accepting (${argCount} args) '${funcArgs
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()}' returning '${
      funcReturns ? funcReturns.replace(/\s+/g, " ").trim() : "record"
    }'`, () => {
      beforeAll(async () => {
        try {
          await pgPool.query(sqlSetup);
        } catch (e) {
          console.error("ERROR DURING SETUP");
          console.error(sqlSetup);
          console.dir(e);
          throw e;
        }
      });
      afterAll(() => pgPool.query(sqlTeardown));

      test("creates messages on meta", async () => {
        const resolveInfos: GraphQLResolveInfoWithMessages[] = [];
        const schema = await getPostGraphileSchema([
          makeHookPlugin(
            (
              input,
              _args,
              _context,
              resolveInfo: GraphQLResolveInfoWithMessages
            ) => {
              resolveInfos.push(resolveInfo);
              return input;
            },
            "after",
            999
          ),
        ]);
        expect(resolveInfos.length).toEqual(0);
        const data = await postgraphql(
          schema,
          op === "insert"
            ? `
                mutation {
                  result: createUser(input: { user: { name: "Bobby Tables", countryCode: "RM", countryIdentificationNumber: "987654321" } }) {
                    user {
                      nodeId
                      id
                      name
                    }
                    messages {
                      level
                      message
                      path
                    }
                  }
                }
              `
            : op === "update"
            ? `
                mutation {
                  result: updateUserById(input: { id: 1, userPatch: { name: "Bobby Tables", countryCode: "RM", countryIdentificationNumber: "987654321" } }) {
                    user {
                      nodeId
                      id
                      name
                    }
                    messages {
                      level
                      message
                      path
                    }
                  }
                }
              `
            : `
                mutation {
                  result: deleteUserById(input: { id: 1 }) {
                    deletedUserId
                    messages {
                      level
                      message
                      path
                    }
                  }
                }
              `
        );
        expect(data.errors).toBeFalsy();
        expect(resolveInfos.length).toEqual(1);
        expect(resolveInfos[0].graphileMeta.messages.length).toEqual(2);
        expect(resolveInfos[0].graphileMeta.messages[0].message).toContain(
          `before user ${op} mutation`
        );
        expect(resolveInfos[0].graphileMeta.messages[1].message).toMatch(
          `after user ${op} mutation`
        );
        let preName = "";
        let postName = "";
        let preTupleName = "";
        let postTupleName = "";
        let preOp = "";
        let postOp = "";
        if (argCount === 0) {
          preName = postName = " (no args)";
        }
        if (argCount >= 1) {
          if (op === "delete") {
            preName = postName = "; name: ¤";
          } else {
            preName = postName = "; name: Bobby Tables";
          }
        }
        if (argCount >= 2) {
          if (op === "insert") {
            preTupleName = " (tuple.name: ¤)";
          } else {
            preTupleName = " (tuple.name: UZR VUN)";
          }
          if (op === "delete") {
            postTupleName = " (tuple.name: ¤)";
          } else {
            postTupleName = " (tuple.name: BOBBY TABLES)";
          }
        }
        if (argCount >= 3) {
          preOp = postOp = ` (operation: ${op})`;
        }
        const pathPrefix =
          op === "insert"
            ? ["input", "user"]
            : op === "update"
            ? ["input", "userPatch"]
            : [];
        expect(resolveInfos[0].graphileMeta.messages).toEqual([
          {
            code: "INFO1",
            level: "info",
            message: `before user ${op} mutation${preName}${preTupleName}${preOp}`,
            path: [...pathPrefix, "name"],
          },
          {
            code: "INFO1",
            level: "info",
            message: `after user ${op} mutation${postName}${postTupleName}${postOp}`,
            path: [...pathPrefix, "name"],
          },
        ]);
        if (!data.data) {
          throw new Error("Data.data not set");
        }
        expect(snapshotSanitise(data.data.result.messages)).toEqual([
          {
            level: "info",
            message: `before user ${op} mutation${preName}${preTupleName}${preOp}`,
            path: [...pathPrefix, "name"],
          },
          {
            level: "info",
            message: `after user ${op} mutation${postName}${postTupleName}${postOp}`,
            path: [...pathPrefix, "name"],
          },
        ]);
        if (op === "delete") {
          expect(data.data.result.deletedUserId).toEqual("WyJ1c2VycyIsMV0=");
        } else {
          expect(snapshotSanitise(data.data.result.user)).toEqual({
            id: "[NUMBER]",
            name: "BOBBY TABLES",
            nodeId: "[NodeId]",
          });
        }
      });
    });
  });
});

describe("updating", () => {
  const info1Before = `\
create function users_update_before(patch jsonb, old users, op text) returns setof mutation_message as $$
  select row(
    'info',
    'Pre user ' || op || ' mutation; old name: ' || old.name || ', user request: ' || (patch ->> 'name'),
    ARRAY['name'],
    'INFO1'
  )::mutation_message;
$$ language sql volatile set search_path from current;`;
  const info1After = `\
create function users_update_after(patch jsonb, old users, op text) returns setof mutation_message as $$
  select row(
    'info',
    'Post user ' || op || ' mutation; new name: ' || old.name || ', user request: ' || (patch ->> 'name'),
    ARRAY['name'],
    'INFO2'
  )::mutation_message;
$$ language sql volatile set search_path from current;`;
  const info1Messages = [
    {
      code: "INFO1",
      level: "info",
      message:
        "Pre user update mutation; old name: UZR VUN, user request: Zeb Zob",
      path: ["input", "userPatch", "name"],
    },
    {
      code: "INFO2",
      level: "info",
      message:
        "Post user update mutation; new name: ZEB ZOB, user request: Zeb Zob",
      path: ["input", "userPatch", "name"],
    },
  ];

  [
    {
      name: "change name by id",
      beforeSql: info1Before,
      afterSql: info1After,
      messages: info1Messages,
      graphqlMutation: `
        mutation {
          updateUserById(input: { id: 1,  userPatch: { name: "Zeb Zob" } }) {
            user {
              nodeId
              id
              name
            }
            messages {
              level
              message
              path
            }
          }
        }
      `,
    },
    {
      name: "change name by nodeId",
      beforeSql: info1Before,
      afterSql: info1After,
      messages: info1Messages,
      graphqlMutation: `
        mutation {
          updateUser(input: { nodeId: "WyJ1c2VycyIsMV0=",  userPatch: { name: "Zeb Zob" } }) {
            user {
              nodeId
              id
              name
            }
            messages {
              level
              message
              path
            }
          }
        }
      `,
    },
    {
      name: "change name by multi-column unique constraint",
      beforeSql: info1Before,
      afterSql: info1After,
      messages: info1Messages,
      graphqlMutation: `
        mutation {
          updateUserByCountryCodeAndCountryIdentificationNumber(input: { countryCode: "UK", countryIdentificationNumber: "123456789", userPatch: { name: "Zeb Zob" } }) {
            user {
              nodeId
              id
              name
            }
            messages {
              level
              message
              path
            }
          }
        }
      `,
    },
  ].forEach(({ beforeSql, afterSql, name, graphqlMutation, messages }) => {
    const { sqlSetup, sqlTeardown } = setupTeardownFunctions(
      beforeSql,
      afterSql
    );
    describe(name, () => {
      beforeAll(() => pgPool.query(sqlSetup));
      afterAll(() => pgPool.query(sqlTeardown));

      test("is passed correct arguments", async () => {
        const resolveInfos: GraphQLResolveInfoWithMessages[] = [];
        const schema = await getPostGraphileSchema([
          makeHookPlugin(
            (
              input,
              _args,
              _context,
              resolveInfo: GraphQLResolveInfoWithMessages
            ) => {
              resolveInfos.push(resolveInfo);
              return input;
            },
            "after",
            999
          ),
        ]);
        expect(resolveInfos.length).toEqual(0);
        const data = await postgraphql(schema, graphqlMutation);
        if (data.errors) {
          console.log(
            data.errors.map((e: GraphQLError) => e.originalError || e)
          );
        }
        expect(data.errors).toBeFalsy();
        expect(resolveInfos.length).toEqual(1);
        expect(resolveInfos[0].graphileMeta.messages.length).toEqual(2);
        expect(resolveInfos[0].graphileMeta.messages).toEqual(messages);
        expect(snapshotSanitise(data)).toMatchSnapshot();
      });
    });
  });
});
