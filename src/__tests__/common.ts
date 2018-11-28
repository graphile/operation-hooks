import { gql, makeExtendSchemaPlugin } from "graphile-utils";
import { Plugin, buildSchema, defaultPlugins } from "graphile-build";
import OperationHooksPlugin, {
  OperationHookCallback,
  OperationHookGenerator,
} from "../OperationHooksPlugin";
import MutationMessagesPlugin from "../MutationMessagesPlugin";

export const EchoPlugin = makeExtendSchemaPlugin(build => ({
  typeDefs: gql`
    extend type Query {
      echo(message: String!): String @scope(isEchoQuery: true)
    }

    input EchoInput {
      message: String!
    }

    type EchoPayload {
      query: Query
      message: String
    }

    extend type Mutation {
      echo(input: EchoInput!): EchoPayload @scope(isEchoMutation: true)
    }
  `,
  resolvers: {
    Query: {
      echo(_, { message }) {
        return message;
      },
    },
    Mutation: {
      echo(_, { input: { message } }) {
        return {
          query: build.$$isQuery,
          message,
        };
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

export const EchoHiMutation = `
  mutation {
    echo(input: { message: "Hi" }) {
      message
    }
  }
`;

export const makeHookPlugin = (
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
