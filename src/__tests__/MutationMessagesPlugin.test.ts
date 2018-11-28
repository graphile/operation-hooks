import { graphql } from "graphql";
import { EchoHiQuery, getSchema, makeHookPlugin } from "./common";
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
  const data = await graphql(schema, EchoHiQuery);
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
    "echo": "Hi",
  },
}
`);
});
