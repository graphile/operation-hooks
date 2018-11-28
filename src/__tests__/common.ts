import { gql, makeExtendSchemaPlugin } from "graphile-utils";
import { Plugin, buildSchema, defaultPlugins } from "graphile-build";
import OperationHooksPlugin from "../OperationHooksPlugin";
import MutationMessagesPlugin from "../MutationMessagesPlugin";

export const EchoPlugin = makeExtendSchemaPlugin(() => ({
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

export function getSchema(morePlugins: Plugin[] = []) {
  return buildSchema(
    [
      ...defaultPlugins,
      EchoPlugin,
      OperationHooksPlugin,
      MutationMessagesPlugin,
      ...morePlugins,
    ],
    {}
  );
}

export const EchoHiQuery = `
  {
    echo(message: "Hi")
  }
`;
