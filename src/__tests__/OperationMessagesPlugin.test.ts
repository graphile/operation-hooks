import { graphql } from "graphql";
import { getSchema, makeHookPlugin, EchoHiMutation } from "./common";
import { GraphQLResolveInfoWithMessages } from "../OperationMessagesPlugin";

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
      "messages": Array [
        Object {
          "__typename": "OperationMessage",
          "level": "info",
          "message": "All good",
        },
      ],
      "preFlight": false,
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

test("collects messages from before and after mutation and exposes on the payload", async () => {
  const schema = await getSchema([
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "Information from before",
        });
        resolveInfo.graphileMeta.messages.push({
          level: "warn",
          message: "Warning from before",
        });
        return input;
      }
    ),
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "Information from after",
        });
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "More information from after",
        });
        return input;
      },
      "after"
    ),
  ]);
  const result = await graphql(schema, EchoHiMutation);
  expect(result.errors).toBeFalsy();
  expect(result.data).toBeTruthy();
  expect(result.data!.echo).toMatchInlineSnapshot(`
Object {
  "message": "Hi",
  "messages": Array [
    Object {
      "__typename": "OperationMessage",
      "level": "info",
      "message": "Information from before",
    },
    Object {
      "__typename": "OperationMessage",
      "level": "warn",
      "message": "Warning from before",
    },
    Object {
      "__typename": "OperationMessage",
      "level": "info",
      "message": "Information from after",
    },
    Object {
      "__typename": "OperationMessage",
      "level": "info",
      "message": "More information from after",
    },
  ],
  "preFlight": false,
}
`);
});

test("on preflight, collects messages from before mutation then exits", async () => {
  const schema = await getSchema([
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "Information from before",
        });
        resolveInfo.graphileMeta.messages.push({
          level: "warn",
          message: "Warning from before",
        });
        return input;
      }
    ),
    makeHookPlugin(
      (input, _args, _context, resolveInfo: GraphQLResolveInfoWithMessages) => {
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "Information from after",
        });
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: "More information from after",
        });
        return input;
      },
      "after"
    ),
  ]);
  const result = await graphql(schema, EchoHiMutation, null, null, {
    preFlight: true,
  });
  expect(result.errors).toBeFalsy();
  expect(result.data).toBeTruthy();
  expect(result.data!.echo).toMatchInlineSnapshot(`
Object {
  "message": null,
  "messages": Array [
    Object {
      "__typename": "OperationMessage",
      "level": "info",
      "message": "Information from before",
    },
    Object {
      "__typename": "OperationMessage",
      "level": "warn",
      "message": "Warning from before",
    },
  ],
  "preFlight": true,
}
`);
});
