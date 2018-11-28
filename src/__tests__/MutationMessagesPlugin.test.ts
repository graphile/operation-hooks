import { graphql } from "graphql";
import { getSchema, makeHookPlugin, EchoHiMutation } from "./common";
import { GraphQLResolveInfoWithMessages } from "../MutationMessagesPlugin";

test("creates messages on meta", async () => {
  let resolveInfos: GraphQLResolveInfoWithMessages[] = [];
  const schema = await getSchema([
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
        resolveInfos.push(resolveInfo);
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "All good",
        });
        return input;
      }
    ),
  ]);
  expect(resolveInfos.length).toEqual(0);
  const data = await graphql(schema, EchoHiMutation);
  expect(resolveInfos.length).toEqual(1);
  expect(resolveInfos[0].graphileMeta.messages).toMatchInlineSnapshot(`
Array [
  Object {
    "level": "info",
    "message": "All good",
  },
]
`);
  expect(data).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "echo": Object {
      "message": "Hi",
    },
  },
}
`);
});

test("throws if an error message is generated", async () => {
  const schema = await getSchema([
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
        resolveInfo.graphileMeta.messages.push({
          level: "error",
          message: "This is an error message.",
        });
        resolveInfo.graphileMeta.messages.push({
          level: "error",
          message: "This is another error message.",
        });
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "General information.",
        });
        return input;
      }
    ),
  ]);
  const result = await graphql(schema, EchoHiMutation);
  expect(result.errors).toBeTruthy();
  expect(result.errors).toMatchInlineSnapshot(`
Array [
  [GraphQLError: Aborting echo due to error: This is an error message.],
]
`);
  expect(result.errors![0].extensions).toMatchInlineSnapshot(`
Object {
  "messages": Array [
    Object {
      "level": "error",
      "message": "This is an error message.",
    },
    Object {
      "level": "error",
      "message": "This is another error message.",
    },
    Object {
      "level": "info",
      "message": "General information.",
    },
  ],
}
`);
});
