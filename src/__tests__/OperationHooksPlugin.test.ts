import OperationHooksPlugin, {
  OperationHookCallback,
  OperationHookGenerator,
} from "../OperationHooksPlugin";
import { Plugin, buildSchema, defaultPlugins } from "graphile-build";
import { graphql } from "graphql";

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
  buildSchema([...defaultPlugins, OperationHooksPlugin, ...morePlugins], {});

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
  const data = await graphql(
    schema,
    `
      {
        id
      }
    `
  );
  expect(called).toEqual(1);
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": null,
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
  const data = await graphql(
    schema,
    `
      {
        id
      }
    `
  );
  expect(data.errors).toBeTruthy();
  expect(data.errors!.length).toEqual(1);
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": null,
  "errors": Array [
    [GraphQLError: Abort!],
  ],
}
`);
});
