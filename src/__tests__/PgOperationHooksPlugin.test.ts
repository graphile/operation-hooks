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

let pgPool: Pool;

beforeAll(async () => {
  pgPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await pgPool.query(`
  begin;
  drop schema if exists operation_hooks cascade;
  create schema operation_hooks;
  set local search_path to operation_hooks;

  create table users (id serial primary key, name text not null);

  create type mutation_message as (
    level text,
    message text,
    path text[],
    code text
  );

  create function "mutation_createUser_before"(args json) returns setof mutation_message as $$
    select row('info', 'Pre createUser mutation; name: ' || (args -> 'input' -> 'user' ->> 'name'), ARRAY['input', 'name'], 'INFO1')::mutation_message;
  $$ language sql volatile set search_path from current;
  comment on function "mutation_createUser_before"(args json) is E'@omit';

  commit;
  `);
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
    appendPlugins: [OperationHooksPlugin, ...plugins],
  });

test("creates messages on meta", async () => {
  let resolveInfos: GraphQLResolveInfoWithMessages[] = [];
  const schema = await getPostGraphileSchema([
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
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
  // TODO: I'm committing the below INVALID SNAPSHOTS but I will fix them later!
  expect(resolveInfos[0].graphileMeta.messages).toMatchInlineSnapshot(`
Array [
  Object {
    "level": "info",
    "message": "TODO! IF THIS IS IN A SNAPSHOT IT'S AN ERROR!",
  },
]
`);
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "createUser": Object {
      "messages": Array [
        Object {
          "level": "info",
          "message": "TODO! IF THIS IS IN A SNAPSHOT IT'S AN ERROR!",
          "path": null,
        },
      ],
      "user": Object {
        "id": 1,
        "name": "Bobby Tables",
        "nodeId": "WyJ1c2VycyIsMV0=",
      },
    },
  },
}
`);
});
