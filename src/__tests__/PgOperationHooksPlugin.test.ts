// tslint:disable no-console
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

const setupTeardownFunctions = (...sqlDefs: string[]) => {
  const before: string[] = [];
  const after: string[] = [];
  const funcArgses: string[] = [];
  const funcReturnses: string[] = [];
  sqlDefs.forEach(sqlDef => {
    const matches = sqlDef.match(
      /create function ([a-z0-9_]+)\(([^)]+)\) (?:returns ([\s\S]*) )?as \$\$/
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

let pgPool: Pool;
function sqlSearchPath(sql: string) {
  return `
  begin;
  set local search_path to operation_hooks;
  ${sql};
  commit;
  `;
}

beforeAll(async () => {
  pgPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await pgPool.query(
    sqlSearchPath(`
  drop schema if exists operation_hooks cascade;
  create schema operation_hooks;

  create table users (id serial primary key, name text not null);
  insert into users (id, name) values
    (1, 'Uzr Vun');

  select setval('users_id_seq', 1000);

  create type mutation_message as (
    level text,
    message text,
    path text[],
    code text
  );

  `)
  );
});

afterAll(() => {
  pgPool.end();
});

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
    // @ts-ignore See postgraphile#931
    {
      pgPool,
    },
    (postgraphileContext: {}) =>
      withTransaction(pgPool, pgClient =>
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
  rawPrefix: string = ""
): string[] {
  const prefix = rawPrefix ? rawPrefix + " " : "";
  return [
    `${prefix}data json`,
    `${prefix}data jsonb`,
    `${prefix}data json, ${prefix}tuple ${type}`,
    `${prefix}data jsonb, ${prefix}tuple ${type}`,
    `${prefix}data json, ${prefix}tuple ${type}, ${prefix}operation text`,
  ].map(str => base.replace(/___/, str));
}

const equivalentFunctions = [
  ...argVariants(
    `\
create function users_insert_before(___) returns setof mutation_message as $$
  select row(
    'info',
    'Pre user insert mutation; name: ' || (data ->> 'name'),
    ARRAY['name'],
    'INFO1'
  )::mutation_message;
$$ language sql volatile set search_path from current;`,
    "users"
  ),
  ...argVariants(
    `\
create function users_insert_before(___) returns mutation_message[] as $$
  select ARRAY[row(
    'info',
    'Pre user insert mutation; name: ' || (data ->> 'name'),
    ARRAY['name'],
    'INFO1'
  )::mutation_message]
$$ language sql volatile set search_path from current;`,
    "users"
  ),
  ...argVariants(
    `\
create function users_insert_before(___) returns table(
  level text,
  message text,
  path text[],
  code text
) as $$
  select 
    'info',
    'Pre user insert mutation; name: ' || (data ->> 'name'),
    ARRAY['name'],
    'INFO1';
$$ language sql volatile set search_path from current;`,
    "users"
  ),
  ...argVariants(
    `
create function users_insert_before(
  ___,
  out level text,
  out message text,
  out path text[],
  out code text
) as $$
  select 
    'info',
    'Pre user insert mutation; name: ' || (data ->> 'name'),
    ARRAY['name'],
    'INFO1';
$$ language sql volatile set search_path from current;`,
    "users",
    "in"
  ),
];

describe("equivalent functions", () => {
  equivalentFunctions.forEach(sqlDef => {
    const {
      sqlSetup,
      sqlTeardown,
      funcArgses: [funcArgs],
      funcReturnses: [funcReturns],
    } = setupTeardownFunctions(sqlDef);
    describe(`hook accepting '${funcArgs
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()}' returning '${
      funcReturns ? funcReturns.replace(/\s+/g, " ").trim() : "record"
    }'`, () => {
      beforeAll(() => pgPool.query(sqlSetup));
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
          `
            mutation {
              createUser(input: { user: { name: "Bobby Tables" } }) {
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
        );
        expect(data.errors).toBeFalsy();
        expect(resolveInfos.length).toEqual(1);
        expect(resolveInfos[0].graphileMeta.messages.length).toEqual(1);
        expect(resolveInfos[0].graphileMeta.messages[0].message).toMatch(
          /Pre user insert mutation/
        );
        expect(resolveInfos[0].graphileMeta.messages).toEqual([
          {
            code: "INFO1",
            level: "info",
            message: "Pre user insert mutation; name: Bobby Tables",
            path: ["input", "user", "name"],
          },
        ]);
        expect(snapshotSanitise(data)).toEqual({
          data: {
            createUser: {
              messages: [
                {
                  level: "info",
                  message: "Pre user insert mutation; name: Bobby Tables",
                  path: ["input", "user", "name"],
                },
              ],
              user: {
                id: "[NUMBER]",
                name: "Bobby Tables",
                nodeId: "[NodeId]",
              },
            },
          },
        });
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
        "Pre user update mutation; old name: Uzr Vun, user request: Zeb Zob",
      path: ["input", "userPatch", "name"],
    },
    {
      code: "INFO2",
      level: "info",
      message:
        "Post user update mutation; new name: Zeb Zob, user request: Zeb Zob",
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
