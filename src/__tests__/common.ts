import { gql, makeExtendSchemaPlugin } from "graphile-utils";
import { Plugin, buildSchema, defaultPlugins } from "graphile-build";
import OperationHooksPlugin, {
  OperationHookCallback,
  OperationHookGenerator,
} from "../OperationHooksPlugin";

export const EchoPlugin = makeExtendSchemaPlugin((build) => ({
  typeDefs: gql`
    extend type Query {
      echo(message: String!): String @scope(isEchoQuery: true)
    }

    input EchoInput {
      message: String!
    }

    type EchoPayload @scope(isMutationPayload: true) {
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
    [...defaultPlugins, EchoPlugin, OperationHooksPlugin, ...morePlugins],
    {
      operationMessages: true,
      operationMessagesPreflight: true,
    }
  );
}

export const EchoHiQuery = `
  query EchoHiQuery {
    echo(message: "Hi")
  }
`;

export const EchoHiMutation = `
  mutation EchoHiMutation ($preflight: Boolean) {
    echo(input: { message: "Hi" }, preflight: $preflight) {
      message
      messages {
        __typename
        level
        message
        detail
      }
      preflight
    }
  }
`;

export const makeHookPlugin = (
  callback: OperationHookCallback,
  when: "before" | "after" | "error" = "before",
  priority = 500
): Plugin => (builder) => {
  builder.hook("init", (_, build) => {
    const hookForContext: OperationHookGenerator = (_fieldContext) => ({
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
