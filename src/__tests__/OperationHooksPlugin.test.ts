import OperationHooksPlugin, {
  OperationHookCallback,
  OperationHookGenerator,
} from "../OperationHooksPlugin";
import { Plugin, buildSchema, defaultPlugins } from "graphile-build";
import { graphql } from "graphql";
import { gql, makeExtendSchemaPlugin } from "graphile-utils";

const EchoPlugin = makeExtendSchemaPlugin(() => ({
  typeDefs: gql`
    extend type Query {
      echo(message: String!): String @scope(isEchoField: true)
    }
  `,
  resolvers: {
    Query: {
      echo(_, { message }) {
        return message;
      },
    },
  },
}));

const UndoHooksPlugin: Plugin = builder => {
  builder.hook("GraphQLObjectType:fields:field", field => {
    if (field.resolve) {
      delete field.resolve["__asyncHooks"];
    }
    return field;
  });
};

const makeHookPlugin = (
  callback: OperationHookCallback,
  when: "before" | "after" | "error" = "before",
  priority = 500
): Plugin => builder => {
  builder.hook("init", (_, build) => {
    const hookForContext: OperationHookGenerator = _fieldContext => ({
      [when]: [
        {
          priority,
          callback,
        },
      ],
    });
    build.addOperationHook(hookForContext);
    return _;
  });
};

const getSchema = (morePlugins: Plugin[] = []) =>
  buildSchema(
    [...defaultPlugins, EchoPlugin, OperationHooksPlugin, ...morePlugins],
    {}
  );

const EchoHiQuery = `
  {
    echo(message: "Hi")
  }
`;

test("checks all resolvers are wrapped", async () => {
  let err;
  try {
    await buildSchema(
      [...defaultPlugins, OperationHooksPlugin, UndoHooksPlugin],
      {}
    );
  } catch (e) {
    err = e;
  }
  expect(err).toBeTruthy();
  expect(err).toMatchInlineSnapshot(
    `[Error: Schema validation error: operation hooks were not added to the following fields: Query.query, Query.id, Query.node]`
  );
});

test("calls hooks the correct number of times", async () => {
  let called = 0;
  const schema = await getSchema([
    makeHookPlugin(() => {
      called++;
    }),
  ]);
  expect(called).toEqual(0);
  const data = await graphql(schema, EchoHiQuery);
  expect(called).toEqual(1);
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "echo": null,
  },
  "errors": Array [
    [GraphQLError: Logic error: operation hook returned 'undefined'.],
  ],
}
`);
});

test("throwing error in hook aborts resolve", async () => {
  const schema = await getSchema([
    makeHookPlugin(() => {
      throw new Error("Abort!");
    }),
  ]);
  const data = await graphql(schema, EchoHiQuery);
  expect(data.errors).toBeTruthy();
  expect(data.errors!.length).toEqual(1);
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "echo": null,
  },
  "errors": Array [
    [GraphQLError: Abort!],
  ],
}
`);
});

test("allows exiting early without error", async () => {
  const schema = await getSchema([
    makeHookPlugin(input => {
      expect(typeof input).toEqual("symbol");
      return null;
    }),
  ]);
  const data = await graphql(schema, EchoHiQuery);
  expect(data.errors).toBeFalsy();
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "echo": null,
  },
}
`);
});

test("allows replacing/augmenting output", async () => {
  const schema = await getSchema([
    makeHookPlugin(out => {
      return out + "(AFTER)";
    }, "after"),
  ]);
  const data = await graphql(schema, EchoHiQuery);
  expect(data.errors).toBeFalsy();
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "echo": "Hi(AFTER)",
  },
}
`);
});

test("throws error if hook is registered after hooks have been called", async () => {
  const BadlyBehavedPlugin: Plugin = builder =>
    builder.hook("GraphQLObjectType:fields:field", (field, build) => {
      build.addOperationHook(() => ({}));
      return field;
    });
  let err;
  try {
    await getSchema([
      makeHookPlugin(out => {
        return out + "(AFTER)";
      }, "after"),
      BadlyBehavedPlugin,
    ]);
  } catch (e) {
    err = e;
  }
  expect(err).toBeTruthy();
  expect(err).toMatchInlineSnapshot(
    `[Error: Attempted to register operation hook after a hook was applied]`
  );
});
