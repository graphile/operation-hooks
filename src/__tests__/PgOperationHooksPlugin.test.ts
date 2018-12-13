import { graphql, GraphQLSchema } from "graphql";
import { Plugin } from "graphile-build";
import {
  createPostGraphileSchema,
  withPostGraphileContext,
} from "postgraphile";
import { GraphQLResolveInfoWithMessages } from "../OperationMessagesPlugin";
import OperationHooksPlugin from "../OperationHooksPlugin";
import { makeHookPlugin } from "./common";
import { Pool } from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL envvar must be set");
}

function snapshotSanitise(o: any): any {
  if (Array.isArray(o)) {
    return o.map(snapshotSanitise);
  } else if (o && typeof o === "object") {
    let result = {};
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
      graphql(
        schema,
        query,
        rootValue,
        {
          ...postgraphileContext,
          context,
        },
        variables,
        operationName
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
    `${prefix}args json`,
    `${prefix}args jsonb`,
    `${prefix}args json, ${prefix}tuple ${type}`,
    `${prefix}args jsonb, ${prefix}tuple ${type}`,
    `${prefix}args json, ${prefix}tuple ${type}, ${prefix}operation text`,
  ].map(str => base.replace(/___/, str));
}

const equivalentFunctions = [
  ...argVariants(
    `\
create function users_insert_before(___) returns setof mutation_message as $$
  select row(
    'info',
    'Pre user insert mutation; name: ' || (args -> 'input' -> 'user' ->> 'name'),
    ARRAY['input', 'name'],
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
    'Pre user insert mutation; name: ' || (args -> 'input' -> 'user' ->> 'name'),
    ARRAY['input', 'name'],
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
    'Pre user insert mutation; name: ' || (args -> 'input' -> 'user' ->> 'name'),
    ARRAY['input', 'name'],
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
    'Pre user insert mutation; name: ' || (args -> 'input' -> 'user' ->> 'name'),
    ARRAY['input', 'name'],
    'INFO1';
$$ language sql volatile set search_path from current;`,
    "users",
    "in"
  ),
];

describe("equivalent functions", () => {
  equivalentFunctions.forEach((sqlDef, i) => {
    const matches = sqlDef.match(
      /create function ([a-z0-9_]+)\(([^)]+)\) (?:returns ([\s\S]*) )?as \$\$/
    );
    if (!matches) throw new Error(`Don't understand SQL definition ${i}!`);
    const [, funcName, funcArgs, funcReturns] = matches;
    const dropSql = `drop function ${funcName}(${funcArgs});`;
    const omitSql = `comment on function ${funcName}(${funcArgs}) is E'@omit';`;
    describe(`hook accepting '${funcArgs}' returning '${
      funcReturns ? funcReturns.replace(/\s+/g, " ") : "record"
    }'`, () => {
      beforeAll(() => pgPool.query(sqlSearchPath(`${sqlDef};${omitSql};`)));
      afterAll(() => pgPool.query(sqlSearchPath(dropSql)));

      test("creates messages on meta", async () => {
        let resolveInfos: GraphQLResolveInfoWithMessages[] = [];
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
            path: ["input", "name"],
          },
        ]);
        expect(snapshotSanitise(data)).toEqual({
          data: {
            createUser: {
              messages: [
                {
                  level: "info",
                  message: "Pre user insert mutation; name: Bobby Tables",
                  path: ["input", "name"],
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
